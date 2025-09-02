import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const IGNORED_FILES = [
	"package.json", "tsconfig.json", "jsconfig.json", "settings.json", "launch.json",
	"tasks.json", "global.json", "appsettings.json", "config.json", "webpack.config.js",
	"webpack.config.json", "vite.config.js", "vite.config.json", "babel.config.js", "babel.config.json",
	"eslint.json", "eslint.yaml", "eslint.yml", "prettier.json", "prettier.yaml", "prettier.yml",
	"docker-compose.yml", "docker-compose.yaml"
];

export function activate(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand('openapiToHttp.transform', async (uri?: vscode.Uri) => {
		let doc: vscode.TextDocument;
		if (uri) {
			doc = await vscode.workspace.openTextDocument(uri);
		} else if (vscode.window.activeTextEditor) {
			doc = vscode.window.activeTextEditor.document;
		} else {
			vscode.window.showErrorMessage('No OpenAPI file selected.');
			return;
		}

		const filename = path.basename(doc.fileName).toLowerCase();
		const ext = path.extname(doc.fileName).toLowerCase();

		if (
			IGNORED_FILES.includes(filename) ||
			filename.includes('config') ||
			filename.includes('setting') ||
			filename.includes('package') ||
			filename.includes('tsconfig') ||
			filename.includes('jsconfig') ||
			filename.includes('appsettings') ||
			filename.includes('docker-compose')
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
			if (ext === '.json') {
				spec = JSON.parse(doc.getText());
			} else {
				spec = yaml.load(doc.getText());
			}
		} catch (err) {
			vscode.window.showErrorMessage('Failed to parse OpenAPI file: ' + (err as Error).message);
			return;
		}

		if (!spec.paths || typeof spec.paths !== 'object') {
			vscode.window.showErrorMessage('OpenAPI file has no valid "paths" object.');
			return;
		}

		// Detect version
		const isV3 = !!spec.openapi || (spec.info && spec.info.version && spec.info.version.startsWith('3'));
		const isV2 = !!spec.swagger || (spec.info && spec.info.version && spec.info.version.startsWith('2'));
		if (!isV2 && !isV3) {
			vscode.window.showErrorMessage('Cannot detect OpenAPI/Swagger version.');
			return;
		}

		// Choose base URL
		let baseUrl = 'http://localhost:5000';
		if (isV2) {
			const host = spec.host ?? 'localhost';
			const basePath = spec.basePath ?? '';
			const scheme = (spec.schemes && spec.schemes[0]) || 'http';
			baseUrl = `${scheme}://${host}${basePath}`;
		} else if (isV3) {
			baseUrl = spec.servers?.[0]?.url ?? 'http://localhost:5000';
		}

		let httpContent = '';

		// Definitions or Schemas
		const definitions = isV2 ? (spec.definitions ?? {}) : {};
		const schemas = isV3 ? (spec.components?.schemas ?? {}) : {};

		for (const [route, methods] of Object.entries(spec.paths)) {
			for (const [method, info] of Object.entries(methods as any)) {
				const op = info as any;
				httpContent += '###\n';
				httpContent += (op.summary ? `# ${op.summary}\n` : '');
				httpContent += (op.description ? `# ${op.description}\n` : '');
				httpContent += `${method.toUpperCase()} ${baseUrl}${route}\n`;

				// Headers from parameters (v2/v3)
				if (op.parameters) {
					const headers = op.parameters.filter((p: any) => p.in === 'header');
					for (const h of headers) {
						httpContent += `${h.name}: \n`;
					}
				}

				// Query parameters as comments
				if (op.parameters) {
					const queries = op.parameters.filter((p: any) => p.in === 'query');
					for (const q of queries) {
						httpContent += `# Query: ${q.name} (${q.type}) - ${q.description ?? ''}\n`;
					}
				}

				// --- Extract body for POST/PUT/PATCH ---
				if (['post', 'put', 'patch'].includes(method.toLowerCase())) {
					let sample: any = {};

					if (isV2 && op.parameters) {
						// Swagger v2: 'body' parameter
						const bodyParam = op.parameters.find((p: any) => p.in === 'body');
						if (bodyParam) {
							let schema = bodyParam.schema;
							if (schema && schema.$ref) {
								schema = resolveRefV2(definitions, schema.$ref);
							}
							sample = sampleFromSchema(schema, definitions);
							httpContent += `Content-Type: application/json\n\n`;
							httpContent += JSON.stringify(sample, null, 2) + '\n';
						}
					}

					if (isV3 && op.requestBody && op.requestBody.content) {
						// OpenAPI v3: requestBody.content
						let jsonMime = Object.keys(op.requestBody.content).find(k => k.toLowerCase().includes('json'));
						if (!jsonMime) {
							jsonMime = Object.keys(op.requestBody.content)[0];
						}
						if (jsonMime) {
							const contentObj = op.requestBody.content[jsonMime];
							if (contentObj.example) {
								sample = contentObj.example;
							} else if (contentObj.examples) {
								const firstExample = Object.values(contentObj.examples)[0];
								if (firstExample && typeof firstExample === 'object' && 'value' in firstExample) {
									sample = (firstExample as any).value;
								}
							} else if (contentObj.schema) {
								let schemaObj = contentObj.schema;
								if (schemaObj.$ref) {
									schemaObj = resolveRefV3(schemas, schemaObj.$ref);
								}
								sample = sampleFromSchema(schemaObj as any, schemas);
							}
							httpContent += `Content-Type: ${jsonMime}\n\n`;
							httpContent += JSON.stringify(sample, null, 2) + '\n';
						}
					}
				}

				httpContent += '\n';
			}
		}

		const httpPath = doc.fileName.replace(/\.(yaml|yml|json)$/i, '.http');
		fs.writeFileSync(httpPath, httpContent, 'utf-8');

		const httpDoc = await vscode.workspace.openTextDocument(httpPath);
		await vscode.window.showTextDocument(httpDoc);

		vscode.window.showInformationMessage(`Generated .http file at ${httpPath}`);
	});

	context.subscriptions.push(disposable);
}

// --- Helper to resolve $ref in Swagger v2 ---
function resolveRefV2(definitions: any, ref: string): any {
	if (!ref.startsWith('#/definitions/')) { return {}; }
	const defName = ref.replace(/^#\/definitions\//, '');
	return definitions[defName] || {};
}

// --- Helper to resolve $ref in OpenAPI v3 ---
function resolveRefV3(schemas: any, ref: string): any {
	if (!ref.startsWith('#/components/schemas/')) { return {}; }
	const schemaName = ref.replace(/^#\/components\/schemas\//, '');
	return schemas[schemaName] || {};
}

// --- Helper: Generate sample values from JSON Schema (with $ref resolution) ---
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

export function deactivate() { }