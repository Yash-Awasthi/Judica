import "./assets/react-Cs3bNWaL.js";
import { n as createRequestHandler } from "./assets/chunk-JPUPSTYD-CnqocLqu.js";
import { EventEmitter } from "node:events";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
const hrtime$1 = /* @__PURE__ */ Object.assign(function hrtime(startTime) {
	const now = Date.now();
	const seconds = Math.trunc(now / 1e3);
	const nanos = now % 1e3 * 1e6;
	if (startTime) {
		let diffSeconds = seconds - startTime[0];
		let diffNanos = nanos - startTime[0];
		if (diffNanos < 0) {
			diffSeconds = diffSeconds - 1;
			diffNanos = 1e9 + diffNanos;
		}
		return [diffSeconds, diffNanos];
	}
	return [seconds, nanos];
}, { bigint: function bigint() {
	return BigInt(Date.now() * 1e6);
} });
var ReadStream = class {
	fd;
	isRaw = false;
	isTTY = false;
	constructor(fd) {
		this.fd = fd;
	}
	setRawMode(mode) {
		this.isRaw = mode;
		return this;
	}
};
var WriteStream = class {
	fd;
	columns = 80;
	rows = 24;
	isTTY = false;
	constructor(fd) {
		this.fd = fd;
	}
	clearLine(dir, callback) {
		callback && callback();
		return false;
	}
	clearScreenDown(callback) {
		callback && callback();
		return false;
	}
	cursorTo(x, y, callback) {
		callback && typeof callback === "function" && callback();
		return false;
	}
	moveCursor(dx, dy, callback) {
		callback && callback();
		return false;
	}
	getColorDepth(env) {
		return 1;
	}
	hasColors(count, env) {
		return false;
	}
	getWindowSize() {
		return [this.columns, this.rows];
	}
	write(str, encoding, cb) {
		if (str instanceof Uint8Array) str = new TextDecoder().decode(str);
		try {
			console.log(str);
		} catch {}
		cb && typeof cb === "function" && cb();
		return false;
	}
};
/* @__NO_SIDE_EFFECTS__ */
function createNotImplementedError(name) {
	return /* @__PURE__ */ new Error(`[unenv] ${name} is not implemented yet!`);
}
/* @__NO_SIDE_EFFECTS__ */
function notImplemented(name) {
	const fn = () => {
		throw /* @__PURE__ */ createNotImplementedError(name);
	};
	return Object.assign(fn, { __unenv__: true });
}
const NODE_VERSION = "22.14.0";
var Process = class Process extends EventEmitter {
	env;
	hrtime;
	nextTick;
	constructor(impl) {
		super();
		this.env = impl.env;
		this.hrtime = impl.hrtime;
		this.nextTick = impl.nextTick;
		for (const prop of [...Object.getOwnPropertyNames(Process.prototype), ...Object.getOwnPropertyNames(EventEmitter.prototype)]) {
			const value = this[prop];
			if (typeof value === "function") this[prop] = value.bind(this);
		}
	}
	emitWarning(warning, type, code) {
		console.warn(`${code ? `[${code}] ` : ""}${type ? `${type}: ` : ""}${warning}`);
	}
	emit(...args) {
		return super.emit(...args);
	}
	listeners(eventName) {
		return super.listeners(eventName);
	}
	#stdin;
	#stdout;
	#stderr;
	get stdin() {
		return this.#stdin ??= new ReadStream(0);
	}
	get stdout() {
		return this.#stdout ??= new WriteStream(1);
	}
	get stderr() {
		return this.#stderr ??= new WriteStream(2);
	}
	#cwd = "/";
	chdir(cwd) {
		this.#cwd = cwd;
	}
	cwd() {
		return this.#cwd;
	}
	arch = "";
	platform = "";
	argv = [];
	argv0 = "";
	execArgv = [];
	execPath = "";
	title = "";
	pid = 200;
	ppid = 100;
	get version() {
		return `v${NODE_VERSION}`;
	}
	get versions() {
		return { node: NODE_VERSION };
	}
	get allowedNodeEnvironmentFlags() {
		return /* @__PURE__ */ new Set();
	}
	get sourceMapsEnabled() {
		return false;
	}
	get debugPort() {
		return 0;
	}
	get throwDeprecation() {
		return false;
	}
	get traceDeprecation() {
		return false;
	}
	get features() {
		return {};
	}
	get release() {
		return {};
	}
	get connected() {
		return false;
	}
	get config() {
		return {};
	}
	get moduleLoadList() {
		return [];
	}
	constrainedMemory() {
		return 0;
	}
	availableMemory() {
		return 0;
	}
	uptime() {
		return 0;
	}
	resourceUsage() {
		return {};
	}
	ref() {}
	unref() {}
	umask() {
		throw /* @__PURE__ */ createNotImplementedError("process.umask");
	}
	getBuiltinModule() {}
	getActiveResourcesInfo() {
		throw /* @__PURE__ */ createNotImplementedError("process.getActiveResourcesInfo");
	}
	exit() {
		throw /* @__PURE__ */ createNotImplementedError("process.exit");
	}
	reallyExit() {
		throw /* @__PURE__ */ createNotImplementedError("process.reallyExit");
	}
	kill() {
		throw /* @__PURE__ */ createNotImplementedError("process.kill");
	}
	abort() {
		throw /* @__PURE__ */ createNotImplementedError("process.abort");
	}
	dlopen() {
		throw /* @__PURE__ */ createNotImplementedError("process.dlopen");
	}
	setSourceMapsEnabled() {
		throw /* @__PURE__ */ createNotImplementedError("process.setSourceMapsEnabled");
	}
	loadEnvFile() {
		throw /* @__PURE__ */ createNotImplementedError("process.loadEnvFile");
	}
	disconnect() {
		throw /* @__PURE__ */ createNotImplementedError("process.disconnect");
	}
	cpuUsage() {
		throw /* @__PURE__ */ createNotImplementedError("process.cpuUsage");
	}
	setUncaughtExceptionCaptureCallback() {
		throw /* @__PURE__ */ createNotImplementedError("process.setUncaughtExceptionCaptureCallback");
	}
	hasUncaughtExceptionCaptureCallback() {
		throw /* @__PURE__ */ createNotImplementedError("process.hasUncaughtExceptionCaptureCallback");
	}
	initgroups() {
		throw /* @__PURE__ */ createNotImplementedError("process.initgroups");
	}
	openStdin() {
		throw /* @__PURE__ */ createNotImplementedError("process.openStdin");
	}
	assert() {
		throw /* @__PURE__ */ createNotImplementedError("process.assert");
	}
	binding() {
		throw /* @__PURE__ */ createNotImplementedError("process.binding");
	}
	permission = { has: /* @__PURE__ */ notImplemented("process.permission.has") };
	report = {
		directory: "",
		filename: "",
		signal: "SIGUSR2",
		compact: false,
		reportOnFatalError: false,
		reportOnSignal: false,
		reportOnUncaughtException: false,
		getReport: /* @__PURE__ */ notImplemented("process.report.getReport"),
		writeReport: /* @__PURE__ */ notImplemented("process.report.writeReport")
	};
	finalization = {
		register: /* @__PURE__ */ notImplemented("process.finalization.register"),
		unregister: /* @__PURE__ */ notImplemented("process.finalization.unregister"),
		registerBeforeExit: /* @__PURE__ */ notImplemented("process.finalization.registerBeforeExit")
	};
	memoryUsage = Object.assign(() => ({
		arrayBuffers: 0,
		rss: 0,
		external: 0,
		heapTotal: 0,
		heapUsed: 0
	}), { rss: () => 0 });
	mainModule = void 0;
	domain = void 0;
	send = void 0;
	exitCode = void 0;
	channel = void 0;
	getegid = void 0;
	geteuid = void 0;
	getgid = void 0;
	getgroups = void 0;
	getuid = void 0;
	setegid = void 0;
	seteuid = void 0;
	setgid = void 0;
	setgroups = void 0;
	setuid = void 0;
	_events = void 0;
	_eventsCount = void 0;
	_exiting = void 0;
	_maxListeners = void 0;
	_debugEnd = void 0;
	_debugProcess = void 0;
	_fatalException = void 0;
	_getActiveHandles = void 0;
	_getActiveRequests = void 0;
	_kill = void 0;
	_preload_modules = void 0;
	_rawDebug = void 0;
	_startProfilerIdleNotifier = void 0;
	_stopProfilerIdleNotifier = void 0;
	_tickCallback = void 0;
	_disconnect = void 0;
	_handleQueue = void 0;
	_pendingMessage = void 0;
	_channel = void 0;
	_send = void 0;
	_linkedBinding = void 0;
};
var globalProcess = globalThis["process"];
const getBuiltinModule = globalProcess.getBuiltinModule;
var workerdProcess = getBuiltinModule("node:process");
var isWorkerdProcessV2 = globalThis.Cloudflare.compatibilityFlags.enable_nodejs_process_v2;
var unenvProcess = new Process({
	env: globalProcess.env,
	hrtime: isWorkerdProcessV2 ? workerdProcess.hrtime : hrtime$1,
	nextTick: workerdProcess.nextTick
});
const { exit, features, platform } = workerdProcess;
const { env, hrtime, nextTick } = unenvProcess;
const { _channel, _disconnect, _events, _eventsCount, _handleQueue, _maxListeners, _pendingMessage, _send, assert, disconnect, mainModule } = unenvProcess;
const { _debugEnd, _debugProcess, _exiting, _fatalException, _getActiveHandles, _getActiveRequests, _kill, _linkedBinding, _preload_modules, _rawDebug, _startProfilerIdleNotifier, _stopProfilerIdleNotifier, _tickCallback, abort, addListener, allowedNodeEnvironmentFlags, arch, argv, argv0, availableMemory, binding, channel, chdir, config, connected, constrainedMemory, cpuUsage, cwd, debugPort, dlopen, domain, emit, emitWarning, eventNames, execArgv, execPath, exitCode, finalization, getActiveResourcesInfo, getegid, geteuid, getgid, getgroups, getMaxListeners, getuid, hasUncaughtExceptionCaptureCallback, initgroups, kill, listenerCount, listeners, loadEnvFile, memoryUsage, moduleLoadList, off, on, once, openStdin, permission, pid, ppid, prependListener, prependOnceListener, rawListeners, reallyExit, ref, release, removeAllListeners, removeListener, report, resourceUsage, send, setegid, seteuid, setgid, setgroups, setMaxListeners, setSourceMapsEnabled, setuid, setUncaughtExceptionCaptureCallback, sourceMapsEnabled, stderr, stdin, stdout, throwDeprecation, title, traceDeprecation, umask, unref, uptime, version, versions } = isWorkerdProcessV2 ? workerdProcess : unenvProcess;
var _process = {
	abort,
	addListener,
	allowedNodeEnvironmentFlags,
	hasUncaughtExceptionCaptureCallback,
	setUncaughtExceptionCaptureCallback,
	loadEnvFile,
	sourceMapsEnabled,
	arch,
	argv,
	argv0,
	chdir,
	config,
	connected,
	constrainedMemory,
	availableMemory,
	cpuUsage,
	cwd,
	debugPort,
	dlopen,
	disconnect,
	emit,
	emitWarning,
	env,
	eventNames,
	execArgv,
	execPath,
	exit,
	finalization,
	features,
	getBuiltinModule,
	getActiveResourcesInfo,
	getMaxListeners,
	hrtime,
	kill,
	listeners,
	listenerCount,
	memoryUsage,
	nextTick,
	on,
	off,
	once,
	pid,
	platform,
	ppid,
	prependListener,
	prependOnceListener,
	rawListeners,
	release,
	removeAllListeners,
	removeListener,
	report,
	resourceUsage,
	setMaxListeners,
	setSourceMapsEnabled,
	stderr,
	stdin,
	stdout,
	title,
	throwDeprecation,
	traceDeprecation,
	umask,
	uptime,
	version,
	versions,
	domain,
	initgroups,
	moduleLoadList,
	reallyExit,
	openStdin,
	assert,
	binding,
	send,
	exitCode,
	channel,
	getegid,
	geteuid,
	getgid,
	getgroups,
	getuid,
	setegid,
	seteuid,
	setgid,
	setgroups,
	setuid,
	permission,
	mainModule,
	_events,
	_eventsCount,
	_exiting,
	_maxListeners,
	_debugEnd,
	_debugProcess,
	_fatalException,
	_getActiveHandles,
	_getActiveRequests,
	_kill,
	_preload_modules,
	_rawDebug,
	_startProfilerIdleNotifier,
	_stopProfilerIdleNotifier,
	_tickCallback,
	_disconnect,
	_handleQueue,
	_pendingMessage,
	_channel,
	_send,
	_linkedBinding
};
globalThis.process = _process;
/**
* Example Durable Object with RPC methods and SQLite storage.
*
* Key patterns:
* - Call methods directly on stub: `stub.listContacts()` (not fetch!)
* - Use `this.ctx.storage.sql` for SQLite queries
* - Create tables in constructor (runs once per DO instance)
*/
var ExampleDO = class extends DurableObject {
	sql;
	constructor(ctx, env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		this.sql.exec(`
      CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
	}
	/**
	* RPC method - call directly from route loaders/actions:
	*   const stub = context.cloudflare.env.EXAMPLE_DO.get(id);
	*   const contacts = await stub.listContacts();
	*/
	async listContacts() {
		return this.sql.exec("SELECT id, name, email, created_at FROM contacts ORDER BY created_at DESC").toArray();
	}
	/**
	* RPC method for creating a contact.
	* Input is validated with Zod in the route action before calling this.
	*/
	async createContact(input) {
		return this.sql.exec("INSERT INTO contacts (name, email) VALUES (?, ?) RETURNING *", input.name, input.email).one();
	}
	/**
	* RPC method for deleting a contact.
	*/
	async deleteContact(id) {
		this.sql.exec("DELETE FROM contacts WHERE id = ?", id);
	}
	/**
	* Test helper for executing raw SQL. Only use in tests.
	* Useful for setting up test data or verifying database state.
	*/
	_testExecSql(sql, ...params) {
		return this.sql.exec(sql, ...params).toArray();
	}
};
var DEFAULT_TIMEOUT_MS = 3e4;
var DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
function toServiceError(error, fallbackMessage) {
	return {
		message: error instanceof Error ? error.message : fallbackMessage,
		status: typeof error?.status === "number" ? error.status : void 0,
		code: typeof error?.code === "string" ? error.code : void 0,
		number: typeof error?.number === "number" ? error.number : void 0
	};
}
function resolveMaxResponseBytes(env) {
	const raw = (env.DATA_PROXY_MAX_RESPONSE_BYTES ?? "").trim();
	if (!raw) return DEFAULT_MAX_RESPONSE_BYTES;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_RESPONSE_BYTES;
	return parsed;
}
async function readTextWithLimit(response, maxBytes) {
	const contentLengthRaw = response.headers.get("content-length") ?? "";
	if (contentLengthRaw) {
		const contentLength = Number.parseInt(contentLengthRaw, 10);
		if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error(`Local data proxy response too large (${contentLength} bytes > limit ${maxBytes} bytes)`);
	}
	if (!response.body) return response.text();
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let totalBytes = 0;
	let text = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		totalBytes += value.byteLength;
		if (totalBytes > maxBytes) {
			await reader.cancel("response exceeds max bytes");
			throw new Error(`Local data proxy response too large (${totalBytes} bytes > limit ${maxBytes} bytes)`);
		}
		text += decoder.decode(value, { stream: true });
	}
	text += decoder.decode();
	return text;
}
async function readJson(response, maxBytes) {
	const body = await readTextWithLimit(response, maxBytes);
	if (!body.trim()) return {};
	try {
		return JSON.parse(body);
	} catch {
		return { error: `Local data proxy returned non-JSON response (${response.status})` };
	}
}
/**
* Local DATA_PROXY shim used by the starter template.
* Deploy pipeline rewrites this binding to the platform's internal DataProxyService.
*/
var LocalDataProxyService = class extends WorkerEntrypoint {
	baseUrl() {
		const raw = (this.env.DATA_PROXY_URL ?? "").trim();
		if (!raw) throw new Error("DATA_PROXY_URL is not configured for local DATA_PROXY service");
		return raw.replace(/\/+$/, "");
	}
	async request(path, body, fallbackMessage) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
		try {
			const response = await fetch(`${this.baseUrl()}${path}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal: controller.signal
			});
			const payload = await readJson(response, resolveMaxResponseBytes(this.env));
			if (!response.ok) return {
				ok: false,
				error: {
					message: typeof payload.error === "string" ? payload.error : `Local data proxy request failed (${response.status})`,
					status: response.status,
					code: typeof payload.code === "string" ? payload.code : void 0,
					number: typeof payload.number === "number" ? payload.number : void 0
				}
			};
			return {
				ok: true,
				data: payload
			};
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") return {
				ok: false,
				error: {
					message: `Local data proxy request timed out after ${DEFAULT_TIMEOUT_MS}ms`,
					status: 504
				}
			};
			return {
				ok: false,
				error: toServiceError(error, fallbackMessage)
			};
		} finally {
			clearTimeout(timeout);
		}
	}
	async mssqlQuery(request) {
		return this.request("/mssql/query", request, "MSSQL query failed");
	}
	async postgresQuery(request) {
		return this.request("/postgres/query", request, "Postgres query failed");
	}
	async mysqlQuery(request) {
		return this.request("/mysql/query", request, "MySQL query failed");
	}
};
var requestHandler = createRequestHandler(() => import("./assets/server-build-NztHKksG.js"), "production");
var worker_entry_default = { async fetch(request, env, ctx) {
	return requestHandler(request, { cloudflare: {
		env,
		ctx
	} });
} };
export { ExampleDO, LocalDataProxyService, worker_entry_default as default };
