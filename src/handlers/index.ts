import { ISchemaSampler, ISpecVersionHandler } from "../interfaces";

// V2 Handler
export class V2Handler implements ISpecVersionHandler {
    getBaseUrl(spec: any): string {
        const host = spec.host ?? 'localhost';
        const basePath = spec.basePath ?? '';
        const scheme = Array.isArray(spec.schemes) ? spec.schemes[0] : 'http';
        return `${scheme}://${host}${basePath}`;
    }

    getSchemas(spec: any): any {
        return spec.definitions ?? {};
    }

    extractRequestBody(op: any): any | null {
        if (Array.isArray(op.parameters)) {
            const bodyParam = op.parameters.find((p: any) => p.in === 'body');
            if (bodyParam?.schema) {
                return bodyParam.schema;
            }
        }
        return null;
    }
}

// V3 Handler
export class V3Handler implements ISpecVersionHandler {
    getBaseUrl(spec: any): string {
        return spec.servers?.[0]?.url ?? 'http://localhost:5000';
    }

    getSchemas(spec: any): any {
        return spec.components?.schemas ?? {};
    }

    extractRequestBody(op: any): any | null {
        if (op.requestBody?.content) {
            const contentTypes = Object.keys(op.requestBody.content);
            const jsonMime = contentTypes.find(k => k.toLowerCase().includes('json')) ?? contentTypes[0];
            const contentObj = op.requestBody.content[jsonMime];
            if (contentObj?.schema) {
                return contentObj.schema;
            }
        }
        return null;
    }
}

export class DefaultSchemaSampler implements ISchemaSampler {
    sample(schema: any, schemas: any, seenRefs = new Set<string>(), isV3: boolean = false): any {
        if (!schema) {
            return {};
        }
        if (schema.$ref && typeof schema.$ref === "string") {
            if (seenRefs.has(schema.$ref)) {
                return {};
            }
            seenRefs.add(schema.$ref);
            const resolved = this.resolveRef(schemas, schema.$ref, isV3);
            return this.sample(resolved, schemas, seenRefs, isV3);
        }
        if (schema.example !== undefined) {
            return schema.example;
        }
        if (schema.default !== undefined) {
            return schema.default;
        }
        if (schema.type === 'object' && schema.properties) {
            const obj: any = {};
            for (const [k, v] of Object.entries(schema.properties)) {
                obj[k] = this.sample(v as any, schemas, seenRefs, isV3);
            }
            return obj;
        }
        if (schema.type === 'array' && schema.items) {
            return [this.sample(schema.items as any, schemas, seenRefs, isV3)];
        }
        if (Array.isArray(schema.enum)) {
            return schema.enum[0];
        }
        if (schema.type === 'string') {
            return "";
        }
        if (schema.type === 'integer' || schema.type === 'number') {
            return 0;
        }
        if (schema.type === 'boolean') {
            return false;
        }
        return {};
    }

    public resolveRef(schemas: any, ref: string, isV3: boolean): any {
        if (!ref) return {};
        if (isV3) {
            if (!ref.startsWith('#/components/schemas/')) return {};
            return schemas[ref.slice(21)] ?? {};
        } else {
            if (!ref.startsWith('#/definitions/')) return {};
            return schemas[ref.slice(14)] ?? {};
        }
    }
}

// Factory for sampler (easy to extend)
export function createSchemaSampler(): ISchemaSampler {
    return new DefaultSchemaSampler();
}


export class DefaultHttpGenerator {
    generate(spec: any, handler: ISpecVersionHandler, sampler: ISchemaSampler, isV3: boolean): string[] {
        const httpLines: string[] = [];

        const baseUrl = handler.getBaseUrl(spec);
        const schemas = handler.getSchemas(spec);

        for (const [route, methods] of Object.entries(spec.paths)) {
            for (const [method, info] of Object.entries(methods as any)) {
                const op = info as any;
                httpLines.push('###');
                if (op.summary) httpLines.push(`# ${op.summary}`);
                if (op.description) httpLines.push(`# ${op.description}`);
                httpLines.push(`${method.toUpperCase()} ${baseUrl}${route}`);

                // Headers from parameters
                if (Array.isArray(op.parameters)) {
                    for (const h of op.parameters.filter((p: any) => p.in === 'header')) {
                        httpLines.push(`${h.name}: `);
                    }
                    for (const q of op.parameters.filter((p: any) => p.in === 'query')) {
                        httpLines.push(`# Query: ${q.name} (${q.type ?? 'unknown'}) - ${q.description ?? ''}`);
                    }
                }

                // Body for POST/PUT/PATCH
                if (['post', 'put', 'patch'].includes(method.toLowerCase())) {
                    let sample: any = {};
                    let contentType = 'application/json';
                    const requestBodySchema = handler.extractRequestBody(op);
                    if (requestBodySchema) {
                        let schema = requestBodySchema;
                        if (requestBodySchema.$ref) {
                            schema = (sampler as DefaultSchemaSampler).resolveRef(schemas, requestBodySchema.$ref, isV3);
                        }
                        sample = sampler.sample(schema, schemas, new Set(), isV3);
                    } else if (isV3 && op.requestBody?.content) {
                        // Fallback for examples if no schema
                        const contentTypes = Object.keys(op.requestBody.content);
                        contentType = contentTypes.find(k => k.toLowerCase().includes('json')) ?? contentTypes[0];
                        const contentObj = op.requestBody.content[contentType];
                        if (contentObj) {
                            if (contentObj.example) {
                                sample = contentObj.example;
                            } else if (contentObj.examples) {
                                const firstExample = Object.values(contentObj.examples)[0];
                                sample = firstExample && typeof firstExample === 'object' && 'value' in firstExample
                                    ? (firstExample as any).value
                                    : {};
                            }
                        }
                    }
                    if (Object.keys(sample).length > 0) {
                        httpLines.push(`Content-Type: ${contentType}\n`);
                        httpLines.push(JSON.stringify(sample, null, 2));
                    }
                    httpLines.push('');
                }
            }
        }

        return httpLines;
    }
}

// Factory to create handler based on version (easy to extend for new versions)
export function createVersionHandler(isV3: boolean): ISpecVersionHandler {
    return isV3 ? new V3Handler() : new V2Handler();
}