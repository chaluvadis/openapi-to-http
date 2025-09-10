"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultHttpGenerator = exports.DefaultSchemaSampler = exports.V3Handler = exports.V2Handler = void 0;
exports.createSchemaSampler = createSchemaSampler;
exports.createVersionHandler = createVersionHandler;
// V2 Handler
class V2Handler {
    getBaseUrl(spec) {
        const host = spec.host ?? 'localhost';
        const basePath = spec.basePath ?? '';
        const scheme = Array.isArray(spec.schemes) ? spec.schemes[0] : 'http';
        return `${scheme}://${host}${basePath}`;
    }
    getSchemas(spec) {
        return spec.definitions ?? {};
    }
    extractRequestBody(op) {
        if (Array.isArray(op.parameters)) {
            const bodyParam = op.parameters.find((p) => p.in === 'body');
            if (bodyParam?.schema) {
                return bodyParam.schema;
            }
        }
        return null;
    }
}
exports.V2Handler = V2Handler;
// V3 Handler
class V3Handler {
    getBaseUrl(spec) {
        return spec.servers?.[0]?.url ?? 'http://localhost:5000';
    }
    getSchemas(spec) {
        return spec.components?.schemas ?? {};
    }
    extractRequestBody(op) {
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
exports.V3Handler = V3Handler;
class DefaultSchemaSampler {
    sample(schema, schemas, seenRefs = new Set(), isV3 = false) {
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
            const obj = {};
            for (const [k, v] of Object.entries(schema.properties)) {
                obj[k] = this.sample(v, schemas, seenRefs, isV3);
            }
            return obj;
        }
        if (schema.type === 'array' && schema.items) {
            return [this.sample(schema.items, schemas, seenRefs, isV3)];
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
    resolveRef(schemas, ref, isV3) {
        if (!ref)
            return {};
        if (isV3) {
            if (!ref.startsWith('#/components/schemas/'))
                return {};
            return schemas[ref.slice(21)] ?? {};
        }
        else {
            if (!ref.startsWith('#/definitions/'))
                return {};
            return schemas[ref.slice(14)] ?? {};
        }
    }
}
exports.DefaultSchemaSampler = DefaultSchemaSampler;
// Factory for sampler (easy to extend)
function createSchemaSampler() {
    return new DefaultSchemaSampler();
}
class DefaultHttpGenerator {
    generate(spec, handler, sampler, isV3) {
        const httpLines = [];
        const baseUrl = handler.getBaseUrl(spec);
        const schemas = handler.getSchemas(spec);
        for (const [route, methods] of Object.entries(spec.paths)) {
            for (const [method, info] of Object.entries(methods)) {
                const op = info;
                httpLines.push('###');
                if (op.summary)
                    httpLines.push(`# ${op.summary}`);
                if (op.description)
                    httpLines.push(`# ${op.description}`);
                httpLines.push(`${method.toUpperCase()} ${baseUrl}${route}`);
                // Headers from parameters
                if (Array.isArray(op.parameters)) {
                    for (const h of op.parameters.filter((p) => p.in === 'header')) {
                        httpLines.push(`${h.name}: `);
                    }
                    for (const q of op.parameters.filter((p) => p.in === 'query')) {
                        httpLines.push(`# Query: ${q.name} (${q.type ?? 'unknown'}) - ${q.description ?? ''}`);
                    }
                }
                // Body for POST/PUT/PATCH
                if (['post', 'put', 'patch'].includes(method.toLowerCase())) {
                    let sample = {};
                    let contentType = 'application/json';
                    const requestBodySchema = handler.extractRequestBody(op);
                    if (requestBodySchema) {
                        let schema = requestBodySchema;
                        if (requestBodySchema.$ref) {
                            schema = sampler.resolveRef(schemas, requestBodySchema.$ref, isV3);
                        }
                        sample = sampler.sample(schema, schemas, new Set(), isV3);
                    }
                    else if (isV3 && op.requestBody?.content) {
                        // Fallback for examples if no schema
                        const contentTypes = Object.keys(op.requestBody.content);
                        contentType = contentTypes.find(k => k.toLowerCase().includes('json')) ?? contentTypes[0];
                        const contentObj = op.requestBody.content[contentType];
                        if (contentObj) {
                            if (contentObj.example) {
                                sample = contentObj.example;
                            }
                            else if (contentObj.examples) {
                                const firstExample = Object.values(contentObj.examples)[0];
                                sample = firstExample && typeof firstExample === 'object' && 'value' in firstExample
                                    ? firstExample.value
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
exports.DefaultHttpGenerator = DefaultHttpGenerator;
// Factory to create handler based on version (easy to extend for new versions)
function createVersionHandler(isV3) {
    return isV3 ? new V3Handler() : new V2Handler();
}
//# sourceMappingURL=index.js.map