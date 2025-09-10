import * as vscode from 'vscode';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { createSchemaSampler, createVersionHandler, DefaultHttpGenerator } from './handlers';

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
		let isV3: boolean;

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
		isV3 = typeof v === 'string' ? v.startsWith('3') : Boolean(spec.openapi);
		const isV2 = typeof v === 'string' ? v.startsWith('2') : Boolean(spec.swagger);

		if (!isV2 && !isV3) {
			vscode.window.showErrorMessage('Cannot detect OpenAPI/Swagger version.');
			return;
		}

		// Create version handler
		const handler = createVersionHandler(isV3);
		const sampler = createSchemaSampler();
		const generator = new DefaultHttpGenerator();
		const httpLines = generator.generate(spec, handler, sampler, isV3);

		const httpPath = doc.fileName.replace(/\.(yaml|yml|json)$/i, '.http');
		await fsPromises.writeFile(httpPath, httpLines.join('\n'), 'utf8');

		const httpDoc = await vscode.workspace.openTextDocument(httpPath);
		await vscode.window.showTextDocument(httpDoc);

		vscode.window.showInformationMessage(`Generated .http file at ${httpPath}`);
	});

	context.subscriptions.push(disposable);
}

export function deactivate() { }
