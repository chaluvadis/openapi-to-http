"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const vscode = __importStar(require("vscode"));
const handlers_1 = require("../handlers");
suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');
    test('Sample test', () => {
        assert.strictEqual(-1, [1, 2, 3].indexOf(5));
        assert.strictEqual(-1, [1, 2, 3].indexOf(0));
    });
    test('V2 Handler baseUrl', () => {
        const spec = { host: 'api.example.com', basePath: '/v1', schemes: ['https'] };
        const handler = new handlers_1.V2Handler();
        assert.strictEqual(handler.getBaseUrl(spec), 'https://api.example.com/v1');
    });
    test('V3 Handler schemas', () => {
        const spec = { components: { schemas: { User: { type: 'object' } } } };
        const handler = new handlers_1.V3Handler();
        assert.strictEqual(Object.keys(handler.getSchemas(spec)).length, 1);
    });
    test('DefaultSchemaSampler basic sample', () => {
        const sampler = new handlers_1.DefaultSchemaSampler();
        const schema = { type: 'string' };
        assert.strictEqual(sampler.sample(schema, {}, new Set(), false), '');
    });
    test('DefaultHttpGenerator empty spec', () => {
        const generator = new handlers_1.DefaultHttpGenerator();
        const spec = { paths: {} };
        const handler = new handlers_1.V2Handler();
        const sampler = new handlers_1.DefaultSchemaSampler();
        const lines = generator.generate(spec, handler, sampler, false);
        assert.ok(lines.length === 0);
    });
    test('Factory functions', () => {
        const v2Handler = (0, handlers_1.createVersionHandler)(false);
        assert.ok(v2Handler instanceof handlers_1.V2Handler);
        const v3Handler = (0, handlers_1.createVersionHandler)(true);
        assert.ok(v3Handler instanceof handlers_1.V3Handler);
        const sampler = (0, handlers_1.createSchemaSampler)();
        assert.ok(sampler instanceof handlers_1.DefaultSchemaSampler);
    });
});
//# sourceMappingURL=extension.test.js.map