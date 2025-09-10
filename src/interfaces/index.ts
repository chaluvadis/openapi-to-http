export interface ISpecVersionHandler {
    getBaseUrl(spec: any): string;
    getSchemas(spec: any): any;
    extractRequestBody(op: any): any | null;
}

// Interface for schema sampling (OCP: open for extension via new implementations)
export interface ISchemaSampler {
    sample(schema: any, schemas: any, seenRefs: Set<string>, isV3: boolean): any;
}