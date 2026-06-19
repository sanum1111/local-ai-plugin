//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let http = require("http");
http = __toESM(http, 1);
let path = require("path");
path = __toESM(path, 1);
let fs = require("fs");
fs = __toESM(fs, 1);
//#region server/config.js
var port = parseInt(process.argv[3], 10);
if (!port) {
	console.error("[Secure AI-Bridge] CRITICAL ERROR: Port not provided by Kotlin process. Exiting.");
	process.exit(1);
}
var OLLAMA_CHAT_URL = "http://localhost:11434/api/chat";
var OLLAMA_TAGS_URL = "http://localhost:11434/api/tags";
var targetProjectDir = process.argv[2] ? process.argv[2] : process.cwd();
var rootDir = path.default.resolve(targetProjectDir);
//#endregion
//#region server/utils.js
var sendError = (res, statusCode, message, details = "") => {
	res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
	res.end(JSON.stringify({
		error: message,
		details: details ? details.toString() : ""
	}));
};
function getSafePath(urlParam) {
	let cleanParam = decodeURIComponent(urlParam || "").trim();
	if (cleanParam === "undefined" || cleanParam === "null") cleanParam = "";
	if (cleanParam.startsWith("/")) cleanParam = cleanParam.slice(1);
	const finalPath = path.default.resolve(rootDir, cleanParam);
	const relative = path.default.relative(rootDir, finalPath);
	if (relative.startsWith("..") || path.default.isAbsolute(relative)) return null;
	return finalPath;
}
//#endregion
//#region server/routes/filesystem.js
var SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	".idea",
	".vscode"
]);
var MAX_RESULTS = 50;
async function searchInDir(dirPath, query, results) {
	if (results.length >= MAX_RESULTS) return;
	let entries;
	try {
		entries = await fs.default.promises.readdir(dirPath, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (results.length >= MAX_RESULTS) break;
		const fullPath = path.default.join(dirPath, entry.name);
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) await searchInDir(fullPath, query, results);
		} else {
			let content;
			try {
				content = await fs.default.promises.readFile(fullPath, "utf8");
			} catch {
				continue;
			}
			const lines = content.split("\n");
			const lowerQuery = query.toLowerCase();
			for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) if (lines[i].toLowerCase().includes(lowerQuery)) results.push({
				file: path.default.relative(rootDir, fullPath).replace(/\\/g, "/"),
				line: i + 1,
				content: lines[i].trim()
			});
		}
	}
}
var readHandler = async (req, res, urlArgs) => {
	try {
		const filePath = getSafePath(urlArgs.get("path"));
		if (!filePath) return sendError(res, 403, "Access Denied: Path is outside project root");
		const data = await fs.default.promises.readFile(filePath, "utf8");
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({
			success: true,
			content: data
		}));
	} catch (err) {
		sendError(res, 404, "Failed to read file", err.message);
	}
};
var writeHandler = async (req, res, urlArgs) => {
	try {
		const filePath = getSafePath(urlArgs.get("path"));
		if (!filePath) return sendError(res, 403, "Access Denied");
		let body = [];
		req.on("data", (chunk) => body.push(chunk)).on("end", async () => {
			try {
				const dataToWrite = Buffer.concat(body).toString();
				await fs.default.promises.writeFile(filePath, dataToWrite, "utf8");
				res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
				res.end(JSON.stringify({
					success: true,
					message: "File written successfully"
				}));
			} catch (writeErr) {
				sendError(res, 500, "Error writing to file", writeErr.message);
			}
		});
	} catch (err) {
		sendError(res, 500, "Internal Server Error", err.message);
	}
};
var listHandler = async (req, res, urlArgs) => {
	try {
		const dirPath = getSafePath(urlArgs.get("path"));
		if (!dirPath) return sendError(res, 403, "Access Denied: Path is outside project root");
		const fileList = (await fs.default.promises.readdir(dirPath, { withFileTypes: true })).map((f) => ({
			name: f.name,
			isDirectory: f.isDirectory()
		}));
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({
			success: true,
			files: fileList
		}));
	} catch (err) {
		sendError(res, 404, "Failed to read directory", err.message);
	}
};
var searchHandler = async (req, res, urlArgs) => {
	try {
		const dirPath = getSafePath(urlArgs.get("path"));
		if (!dirPath) return sendError(res, 403, "Access Denied: Path is outside project root");
		const query = (urlArgs.get("query") || "").trim();
		if (!query) return sendError(res, 400, "Missing required parameter: query");
		const results = [];
		await searchInDir(dirPath, query, results);
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({
			success: true,
			results,
			truncated: results.length >= MAX_RESULTS
		}));
	} catch (err) {
		sendError(res, 500, "Search failed", err.message);
	}
};
//#endregion
//#region server/routes/ollama.js
var chatHandler = (req, res) => {
	let body = [];
	req.on("data", (chunk) => body.push(chunk)).on("end", () => {
		try {
			const payload = Buffer.concat(body).toString();
			const ollamaReq = http.default.request(OLLAMA_CHAT_URL, {
				method: "POST",
				headers: { "Content-Type": "application/json" }
			}, (ollamaRes) => {
				res.writeHead(ollamaRes.statusCode, {
					"Content-Type": "application/json; charset=utf-8",
					"Access-Control-Allow-Origin": "*"
				});
				ollamaRes.pipe(res);
			});
			ollamaReq.on("error", (err) => sendError(res, 503, "Ollama is offline or unreachable", err.message));
			ollamaReq.write(payload);
			ollamaReq.end();
		} catch (err) {
			sendError(res, 500, "Chat request failed", err.message);
		}
	});
};
var modelsHandler = (req, res) => {
	try {
		const ollamaReq = http.default.request(OLLAMA_TAGS_URL, { method: "GET" }, (ollamaRes) => {
			let body = [];
			ollamaRes.on("data", (chunk) => body.push(chunk)).on("end", () => {
				res.writeHead(200, {
					"Content-Type": "application/json; charset=utf-8",
					"Access-Control-Allow-Origin": "*"
				});
				res.end(Buffer.concat(body).toString());
			});
		});
		ollamaReq.on("error", (err) => sendError(res, 503, "Ollama offline", err.message));
		ollamaReq.end();
	} catch (err) {
		sendError(res, 500, "Internal Server Error fetching models", err.message);
	}
};
//#endregion
//#region server/index.js
var routes = {
	"/read": readHandler,
	"/write": writeHandler,
	"/list": listHandler,
	"/search": searchHandler,
	"/chat": chatHandler,
	"/models": modelsHandler
};
http.default.createServer((req, res) => {
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type");
	if (req.method === "OPTIONS") {
		res.writeHead(204);
		res.end();
		return;
	}
	try {
		const parsedUrl = new URL(req.url, "http://localhost");
		const route = parsedUrl.pathname;
		if (route in routes) routes[route](req, res, parsedUrl.searchParams);
		else sendError(res, 404, "Endpoint not found");
	} catch (err) {
		sendError(res, 500, "Server routing error", err.message);
	}
}).listen(port, () => {
	console.log(`[Secure AI-Bridge] Server process started.`);
	console.log(`[Secure AI-Bridge] Root directory locked to: ${rootDir}`);
	console.log(`[Secure AI-Bridge] Listening on KOTLIN-assigned port: ${port}`);
});
//#endregion
