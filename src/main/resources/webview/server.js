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
var DELEGATE_TOKEN = process.argv[4] || "";
var DELEGATE_TIMEOUT_MS = 12e4;
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
async function fsRead(relativePath) {
	const filePath = getSafePath(relativePath);
	if (!filePath) throw new Error("Access Denied: Path is outside project root");
	return {
		success: true,
		content: await fs.default.promises.readFile(filePath, "utf8")
	};
}
async function fsWrite(relativePath, content) {
	const filePath = getSafePath(relativePath);
	if (!filePath) throw new Error("Access Denied: Path is outside project root");
	await fs.default.promises.mkdir(path.default.dirname(filePath), { recursive: true });
	await fs.default.promises.writeFile(filePath, content, "utf8");
	return {
		success: true,
		message: "File written successfully"
	};
}
async function fsList(relativePath) {
	const dirPath = getSafePath(relativePath);
	if (!dirPath) throw new Error("Access Denied: Path is outside project root");
	return {
		success: true,
		files: (await fs.default.promises.readdir(dirPath, { withFileTypes: true })).map((f) => ({
			name: f.name,
			isDirectory: f.isDirectory()
		}))
	};
}
async function fsSearch(relativePath, query) {
	const dirPath = getSafePath(relativePath);
	if (!dirPath) throw new Error("Access Denied: Path is outside project root");
	if (!query || !query.trim()) throw new Error("Missing required parameter: query");
	const results = [];
	await searchInDir(dirPath, query.trim(), results);
	return {
		success: true,
		results,
		truncated: results.length >= MAX_RESULTS
	};
}
var readHandler = async (req, res, urlArgs) => {
	try {
		const result = await fsRead(urlArgs.get("path"));
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(result));
	} catch (err) {
		sendError(res, err.message.startsWith("Access Denied") ? 403 : 404, err.message.startsWith("Access Denied") ? err.message : "Failed to read file", err.message);
	}
};
var writeHandler = async (req, res, urlArgs) => {
	try {
		if (!getSafePath(urlArgs.get("path"))) return sendError(res, 403, "Access Denied");
		let body = [];
		req.on("data", (chunk) => body.push(chunk)).on("end", async () => {
			try {
				const result = await fsWrite(urlArgs.get("path"), Buffer.concat(body).toString());
				res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
				res.end(JSON.stringify(result));
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
		const result = await fsList(urlArgs.get("path"));
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(result));
	} catch (err) {
		sendError(res, err.message.startsWith("Access Denied") ? 403 : 404, err.message.startsWith("Access Denied") ? err.message : "Failed to read directory", err.message);
	}
};
var searchHandler = async (req, res, urlArgs) => {
	try {
		const query = (urlArgs.get("query") || "").trim();
		if (!query) return sendError(res, 400, "Missing required parameter: query");
		const result = await fsSearch(urlArgs.get("path"), query);
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(result));
	} catch (err) {
		sendError(res, err.message.startsWith("Access Denied") ? 403 : 500, "Search failed", err.message);
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
//#region server/delegateSystemPrompt.js
var DELEGATE_SYSTEM_PROMPT = `You are a powerful local AI assistant integrated into a developer's IDE via Local AI Bridge.
You have direct access to the project's file system through special tools.

CRITICAL ANTI-HALLUCINATION POLICY:
1. NEVER guess, assume, or fabricate file names, directory structures, or file contents.
2. If you need to know what is in a folder, you MUST use the "list" tool.
3. If a tool returns an error, report the exact error — do not invent an answer.

ERROR HANDLING RULE:
If the system returns a JSON object with an "error" field after a tool call, you MUST inform the caller about the error and include the exact error message.

HOW TO CALL A TOOL:
When you need to use a tool, your ENTIRE response must be a single raw JSON object and nothing else.

MANDATORY FORMAT RULES (violations cause tool calls to fail):
- Output ONLY the JSON object — no text before it, no text after it.
- Do NOT wrap JSON in markdown code fences (no \`\`\`json ... \`\`\` or \`\`\` ... \`\`\`).
- Do NOT add explanations, comments, or reasoning around the JSON.
- Do NOT use XML/HTML tags (no <think>, <tool>, or any other tags).
- The response must start with { and end with } and contain nothing else.

CORRECT example (tool call):
{"tool": "read", "path": "package.json"}

INCORRECT examples (will break the system):
Here is my tool call: {"tool": "read", "path": "package.json"}
\`\`\`json
{"tool": "read", "path": "package.json"}
\`\`\`
<think>I need to read the file</think>{"tool": "read", "path": "package.json"}

Available tools:
1. {"tool": "list", "path": "relative/path"}        — list directory contents ("" for root)
2. {"tool": "read", "path": "relative/path/file"}   — read file contents
3. {"tool": "write", "path": "relative/path/file", "content": "..."}  — write/overwrite file
4. {"tool": "search", "path": "relative/path", "query": "text"}       — search text in files

TOOL USAGE RULES:
- Use paths relative to the project root.
- When you output a tool JSON the system executes it and returns the result in the next message.
- When you have enough information to answer, respond in plain text (no JSON).
- Always respond in the language the task is written in.`;
//#endregion
//#region server/agenticLoop.js
var TOOL_JSON_RE = /\{[\s\S]*\}/;
function sanitizeModelOutput(text) {
	return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
}
function callOllama(model, messages) {
	return new Promise((resolve, reject) => {
		const payload = JSON.stringify({
			model,
			messages,
			stream: false
		});
		const req = http.default.request(OLLAMA_CHAT_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Content-Length": Buffer.byteLength(payload)
			}
		}, (res) => {
			const chunks = [];
			res.on("data", (chunk) => chunks.push(chunk));
			res.on("end", () => {
				try {
					resolve(JSON.parse(Buffer.concat(chunks).toString()).message?.content || "");
				} catch (err) {
					reject(/* @__PURE__ */ new Error(`Failed to parse Ollama response: ${err.message}`));
				}
			});
		});
		req.on("error", reject);
		req.write(payload);
		req.end();
	});
}
function fetchFirstModel() {
	return new Promise((resolve, reject) => {
		const req = http.default.request(OLLAMA_TAGS_URL, { method: "GET" }, (res) => {
			const chunks = [];
			res.on("data", (chunk) => chunks.push(chunk));
			res.on("end", () => {
				try {
					const first = JSON.parse(Buffer.concat(chunks).toString()).models?.[0]?.name;
					if (!first) return reject(/* @__PURE__ */ new Error("No Ollama models available"));
					resolve(first);
				} catch (err) {
					reject(/* @__PURE__ */ new Error(`Failed to parse models response: ${err.message}`));
				}
			});
		});
		req.on("error", reject);
		req.end();
	});
}
async function executeTool(action) {
	switch (action.tool) {
		case "list": return JSON.stringify(await fsList(action.path ?? ""));
		case "read": return JSON.stringify(await fsRead(action.path));
		case "write": return JSON.stringify(await fsWrite(action.path, action.content ?? ""));
		case "search": return JSON.stringify(await fsSearch(action.path ?? "", action.query));
		default: return JSON.stringify({ error: `Unknown tool: ${action.tool}` });
	}
}
/**
* Runs the agentic loop server-side against Ollama.
*
* @param {object} options
* @param {string}   options.task          — task instruction for the local model
* @param {string}  [options.model]        — Ollama model name; auto-detected if omitted
* @param {string}  [options.systemPrompt] — overrides the default system prompt
* @param {Array}   [options.context]      — additional {role, content} messages prepended to the task
* @param {number}  [options.maxLoops=7]   — max agentic loop iterations
* @returns {Promise<{result: string, model: string, loops: number}>}
*/
async function runAgenticLoop({ task, model, systemPrompt, context = [], maxLoops = 7 }) {
	const deadline = Date.now() + DELEGATE_TIMEOUT_MS;
	const resolvedModel = model || await fetchFirstModel();
	const messages = [
		{
			role: "system",
			content: systemPrompt || DELEGATE_SYSTEM_PROMPT
		},
		...context,
		{
			role: "user",
			content: task
		}
	];
	let loops = 0;
	let lastActionString = "";
	for (let i = 0; i < maxLoops; i++) {
		if (Date.now() > deadline) return {
			result: "Delegate timeout: the task took too long to complete.",
			model: resolvedModel,
			loops
		};
		const aiText = await callOllama(resolvedModel, messages);
		loops++;
		const sanitized = sanitizeModelOutput(aiText);
		const jsonMatch = sanitized.match(TOOL_JSON_RE);
		if (!jsonMatch) return {
			result: aiText,
			model: resolvedModel,
			loops
		};
		let action;
		try {
			action = JSON.parse(jsonMatch[0].trim());
		} catch {
			messages.push({
				role: "assistant",
				content: aiText
			});
			messages.push({
				role: "user",
				content: JSON.stringify({ error: "Failed to parse tool JSON." })
			});
			continue;
		}
		if (!action.tool) return {
			result: sanitized,
			model: resolvedModel,
			loops
		};
		const actionString = JSON.stringify(action);
		if (actionString === lastActionString) return {
			result: "The local model entered an infinite loop and was stopped. Last action: " + actionString,
			model: resolvedModel,
			loops
		};
		lastActionString = actionString;
		let toolResult;
		try {
			toolResult = await executeTool(action);
		} catch (err) {
			toolResult = JSON.stringify({
				error: "Tool execution error",
				details: err.message
			});
		}
		messages.push({
			role: "assistant",
			content: aiText
		});
		messages.push({
			role: "user",
			content: `[Tool result ${action.tool}]: ${toolResult}`
		});
	}
	return {
		result: "Max loop iterations reached without a final answer.",
		model: resolvedModel,
		loops
	};
}
//#endregion
//#region server/routes/delegate.js
function parseBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString()));
			} catch {
				reject(/* @__PURE__ */ new Error("Invalid JSON body"));
			}
		});
		req.on("error", reject);
	});
}
var delegateHandler = async (req, res) => {
	if (req.method !== "POST") return sendError(res, 405, "Method Not Allowed", "POST required");
	if (DELEGATE_TOKEN) {
		if ((req.headers["authorization"] || "") !== `Bearer ${DELEGATE_TOKEN}`) return sendError(res, 401, "Unauthorized", "Invalid or missing Authorization header");
	}
	let body;
	try {
		body = await parseBody(req);
	} catch (err) {
		return sendError(res, 400, "Bad Request", err.message);
	}
	const { task, model, systemPrompt, maxLoops, context } = body;
	if (!task || typeof task !== "string" || !task.trim()) return sendError(res, 400, "Bad Request", "\"task\" field is required and must be a non-empty string");
	if (maxLoops !== void 0 && (typeof maxLoops !== "number" || maxLoops < 1 || maxLoops > 20)) return sendError(res, 400, "Bad Request", "\"maxLoops\" must be a number between 1 and 20");
	if (context !== void 0 && !Array.isArray(context)) return sendError(res, 400, "Bad Request", "\"context\" must be an array of {role, content} objects");
	try {
		const { result, model: usedModel, loops } = await runAgenticLoop({
			task: task.trim(),
			model: model || void 0,
			systemPrompt: systemPrompt || void 0,
			context: Array.isArray(context) ? context : [],
			maxLoops: typeof maxLoops === "number" ? maxLoops : 7
		});
		res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({
			result,
			model: usedModel,
			loops
		}));
	} catch (err) {
		sendError(res, 503, "Delegate failed", err.message);
	}
};
//#endregion
//#region server/routes/config.js
function configHandler(req, res) {
	if (req.method !== "GET") {
		res.writeHead(405, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "Method Not Allowed" }));
		return;
	}
	res.writeHead(200, { "Content-Type": "application/json" });
	res.end(JSON.stringify({
		port,
		token: DELEGATE_TOKEN || ""
	}));
}
//#endregion
//#region server/index.js
var routes = {
	"/read": readHandler,
	"/write": writeHandler,
	"/list": listHandler,
	"/search": searchHandler,
	"/chat": chatHandler,
	"/models": modelsHandler,
	"/delegate": delegateHandler,
	"/config": configHandler
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
}).listen(port, "127.0.0.1", () => {
	console.log(`[Secure AI-Bridge] Server process started.`);
	console.log(`[Secure AI-Bridge] Root directory locked to: ${rootDir}`);
	console.log(`[Secure AI-Bridge] Listening on KOTLIN-assigned port: ${port} (localhost only)`);
});
//#endregion
