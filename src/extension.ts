import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// Use Set for faster lookup and reduce duplicated checks
const IGNORED_FILES = new Set([
	"package.json", "tsconfig.json", "jsconfig.json", "settings.json", "launch.json",
	"tasks.json", "global.json", "appsettings.json", "config.json", "webpack.config.js",
	"webpack.config.json", "vite.config.js", "vite.config.json", "babel.config.js", "babel.config.json",
	"eslint.json", "eslint.yaml", "eslint.yml", "prettier.json", "prettier.yaml", "prettier.yml",
	"docker-compose.yml", "docker-compose.yaml"
]);

const IGNORED_KEYWORDS = [
	'config', 'setting', 'package', 'tsconfig', 'jsconfig', 'appsettings', 'docker-compose'
];

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand('openapiToHttp.transform', async (uri?: vscode.Uri) => {
		const doc = uri
			? await vscode.workspace.openTextDocument(uri)
			: vscode.window.activeTextEditor?.document;

		if (!doc) {
			vscode.window.showErrorMessage('No OpenAPI file selected.');
			return;
		}

		const filename = path.basename(doc.fileName).toLowerCase();
		const ext = path.extname(doc.fileName).toLowerCase();

		if (
			IGNORED_FILES.has(filename) ||
			IGNORED_KEYWORDS.some(kw => filename.includes(kw))
		) {
			vscode.window.showErrorMessage('This file is not an OpenAPI/Swagger file.');
			return;
		}

		if (!['.yaml', '.yml', '.json'].includes(ext)) {
			vscode.window.showErrorMessage('Active file must be .yaml, .yml, or .json (OpenAPI).');
			return;
		}

		let spec: any;
		try {
			spec = ext === '.json' ? JSON.parse(doc.getText()) : yaml.load(doc.getText());
		} catch (err) {
			vscode.window.showErrorMessage('Failed to parse OpenAPI file: ' + (err as Error).message);
			return;
		}

		if (!spec?.paths || typeof spec.paths !== 'object') {
			vscode.window.showErrorMessage('OpenAPI file has no valid "paths" object.');
			return;
		}

		// Detect version
		const v = spec.openapi ?? spec.swagger ?? spec.info?.version ?? '';
		const isV3 = typeof v === 'string' ? v.startsWith('3') : Boolean(spec.openapi);
		const isV2 = typeof v === 'string' ? v.startsWith('2') : Boolean(spec.swagger);

		if (!isV2 && !isV3) {
			vscode.window.showErrorMessage('Cannot detect OpenAPI/Swagger version.');
			return;
		}

		// Base URL
		let baseUrl: string;
		if (isV2) {
			const host = spec.host ?? 'localhost';
			const basePath = spec.basePath ?? '';
			const scheme = Array.isArray(spec.schemes) ? spec.schemes[0] : 'http';
			baseUrl = `${scheme}://${host}${basePath}`;
		} else {
			baseUrl = spec.servers?.[0]?.url ?? 'http://localhost:5000';
		}

		const definitions = isV2 ? (spec.definitions ?? {}) : {};
		const schemas = isV3 ? (spec.components?.schemas ?? {}) : {};

		const httpLines: string[] = [];

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
						httpLines.push(`# Query: ${q.name} (${q.type}) - ${q.description ?? ''}`);
					}
				}

				// Body for POST/PUT/PATCH
				if (['post', 'put', 'patch'].includes(method.toLowerCase())) {
					let sample: any = {};
					if (isV2 && Array.isArray(op.parameters)) {
						const bodyParam = op.parameters.find((p: any) => p.in === 'body');
						if (bodyParam?.schema) {
							const schema = bodyParam.schema.$ref
								? resolveRefV2(definitions, bodyParam.schema.$ref)
								: bodyParam.schema;
							sample = sampleFromSchema(schema, definitions);
							httpLines.push(`Content-Type: application/json\n`);
							httpLines.push(JSON.stringify(sample, null, 2));
						}
					}
					if (isV3 && op.requestBody?.content) {
						const contentTypes = Object.keys(op.requestBody.content);
						let jsonMime = contentTypes.find(k => k.toLowerCase().includes('json')) ?? contentTypes[0];
						const contentObj = op.requestBody.content[jsonMime];
						if (contentObj) {
							if (contentObj.example) {
								sample = contentObj.example;
							} else if (contentObj.examples) {
								const firstExample = Object.values(contentObj.examples)[0];
								sample = firstExample && typeof firstExample === 'object' && 'value' in firstExample
									? (firstExample as any).value
									: {};
							} else if (contentObj.schema) {
								const schemaObj = contentObj.schema.$ref
									? resolveRefV3(schemas, contentObj.schema.$ref)
									: contentObj.schema;
								sample = sampleFromSchema(schemaObj, schemas);
							}
							httpLines.push(`Content-Type: ${jsonMime}\n`);
							httpLines.push(JSON.stringify(sample, null, 2));
						}
					}
				}
				httpLines.push('');
			}
		}

		const httpPath = doc.fileName.replace(/\.(yaml|yml|json)$/i, '.http');
		fs.writeFileSync(httpPath, httpLines.join('\n'), 'utf8');

		const httpDoc = await vscode.workspace.openTextDocument(httpPath);
		await vscode.window.showTextDocument(httpDoc);

		vscode.window.showInformationMessage(`Generated .http file at ${httpPath}`);
	});

	context.subscriptions.push(disposable);
}

// --- Helper to resolve $ref in Swagger v2 ---
function resolveRefV2(definitions: any, ref: string): any {
	if (!ref?.startsWith('#/definitions/')) return {};
	return definitions[ref.slice(14)] ?? {};
}

// --- Helper to resolve $ref in OpenAPI v3 ---
function resolveRefV3(schemas: any, ref: string): any {
	if (!ref?.startsWith('#/components/schemas/')) return {};
	return schemas[ref.slice(21)] ?? {};
}

// --- Generate sample values from JSON Schema (with $ref resolution) ---
function sampleFromSchema(schema: any, definitionsOrSchemas: any, seenRefs = new Set<string>()): any {
	if (!schema) {
		return {};
	}
	if (schema.$ref && typeof schema.$ref === "string") {
		if (seenRefs.has(schema.$ref)) {
			return {};
		}
		seenRefs.add(schema.$ref);
		let resolved;
		// Try v3 first, fallback to v2
		if (schema.$ref.startsWith('#/components/schemas/')) {
			resolved = resolveRefV3(definitionsOrSchemas, schema.$ref);
		} else {
			resolved = resolveRefV2(definitionsOrSchemas, schema.$ref);
		}
		return sampleFromSchema(resolved, definitionsOrSchemas, seenRefs);
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
			obj[k] = sampleFromSchema(v as any, definitionsOrSchemas, seenRefs);
		}
		return obj;
	}
	if (schema.type === 'array' && schema.items) {
		return [sampleFromSchema(schema.items as any, definitionsOrSchemas, seenRefs)];
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

export function deactivate() {}
