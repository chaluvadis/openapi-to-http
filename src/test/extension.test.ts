import * as assert from 'assert';
import * as vscode from 'vscode';
import {
	createSchemaSampler, createVersionHandler, DefaultHttpGenerator,
	DefaultSchemaSampler, V2Handler, V3Handler
} from '../handlers';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('V2 Handler baseUrl', () => {
		const spec = { host: 'api.example.com', basePath: '/v1', schemes: ['https'] };
		const handler = new V2Handler();
		assert.strictEqual(handler.getBaseUrl(spec), 'https://api.example.com/v1');
	});

	test('V3 Handler schemas', () => {
		const spec = { components: { schemas: { User: { type: 'object' } } } };
		const handler = new V3Handler();
		assert.strictEqual(Object.keys(handler.getSchemas(spec)).length, 1);
	});

	test('DefaultSchemaSampler basic sample', () => {
		const sampler = new DefaultSchemaSampler();
		const schema = { type: 'string' };
		assert.strictEqual(sampler.sample(schema, {}, new Set(), false), '');
	});

	test('DefaultHttpGenerator empty spec', () => {
		const generator = new DefaultHttpGenerator();
		const spec = { paths: {} };
		const handler = new V2Handler();
		const sampler = new DefaultSchemaSampler();
		const lines = generator.generate(spec, handler, sampler, false);
		assert.ok(lines.length === 0);
	});

	test('Factory functions', () => {
		const v2Handler = createVersionHandler(false);
		assert.ok(v2Handler instanceof V2Handler);
		const v3Handler = createVersionHandler(true);
		assert.ok(v3Handler instanceof V3Handler);
		const sampler = createSchemaSampler();
		assert.ok(sampler instanceof DefaultSchemaSampler);
	});
});
