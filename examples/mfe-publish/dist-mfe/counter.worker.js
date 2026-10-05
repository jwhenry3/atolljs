//#region \0rolldown/runtime.js
var e = Object.create, t = Object.defineProperty, n = Object.getOwnPropertyDescriptor, r = Object.getOwnPropertyNames, i = Object.getPrototypeOf, a = Object.prototype.hasOwnProperty, o = (e, t) => () => (t || (e((t = { exports: {} }).exports, t), e = null), t.exports), s = (e, i, o, s) => {
	if (i && typeof i == "object" || typeof i == "function") for (var c = r(i), l = 0, u = c.length, d; l < u; l++) d = c[l], !a.call(e, d) && d !== o && t(e, d, {
		get: ((e) => i[e]).bind(null, d),
		enumerable: !(s = n(i, d)) || s.enumerable
	});
	return e;
}, c = (n, r, o) => (o = n == null ? {} : e(i(n)), s(r || !n || !n.__esModule || !a.call(n, "default") ? t(o, "default", {
	value: n,
	enumerable: !0
}) : o, n)), l = /* @__PURE__ */ o(((e) => {
	var t = Symbol.for("react.transitional.element"), n = Symbol.for("react.portal"), r = Symbol.for("react.fragment"), i = Symbol.for("react.strict_mode"), a = Symbol.for("react.profiler"), o = Symbol.for("react.consumer"), s = Symbol.for("react.context"), c = Symbol.for("react.forward_ref"), l = Symbol.for("react.suspense"), u = Symbol.for("react.memo"), d = Symbol.for("react.lazy"), f = Symbol.for("react.activity"), p = Symbol.for("react.view_transition"), m = Symbol.iterator;
	function h(e) {
		return typeof e != "object" || !e ? null : (e = m && e[m] || e["@@iterator"], typeof e == "function" ? e : null);
	}
	var g = {
		isMounted: function() {
			return !1;
		},
		enqueueForceUpdate: function() {},
		enqueueReplaceState: function() {},
		enqueueSetState: function() {}
	}, _ = Object.assign, v = {};
	function y(e, t, n) {
		this.props = e, this.context = t, this.refs = v, this.updater = n || g;
	}
	y.prototype.isReactComponent = {}, y.prototype.setState = function(e, t) {
		if (typeof e != "object" && typeof e != "function" && e != null) throw Error("takes an object of state variables to update or a function which returns an object of state variables.");
		this.updater.enqueueSetState(this, e, t, "setState");
	}, y.prototype.forceUpdate = function(e) {
		this.updater.enqueueForceUpdate(this, e, "forceUpdate");
	};
	function ee() {}
	ee.prototype = y.prototype;
	function te(e, t, n) {
		this.props = e, this.context = t, this.refs = v, this.updater = n || g;
	}
	var b = te.prototype = new ee();
	b.constructor = te, _(b, y.prototype), b.isPureReactComponent = !0;
	var x = Array.isArray;
	function ne() {}
	var S = {
		H: null,
		A: null,
		T: null,
		S: null
	}, C = Object.prototype.hasOwnProperty;
	function re(e, n, r) {
		var i = r.ref;
		return {
			$$typeof: t,
			type: e,
			key: n,
			ref: i === void 0 ? null : i,
			props: r
		};
	}
	function ie(e, t) {
		return re(e.type, t, e.props);
	}
	function ae(e) {
		return typeof e == "object" && !!e && e.$$typeof === t;
	}
	function oe(e) {
		var t = {
			"=": "=0",
			":": "=2"
		};
		return "$" + e.replace(/[=:]/g, function(e) {
			return t[e];
		});
	}
	var se = /\/+/g;
	function ce(e, t) {
		return typeof e == "object" && e && e.key != null ? oe("" + e.key) : t.toString(36);
	}
	function le(e) {
		switch (e.status) {
			case "fulfilled": return e.value;
			case "rejected": throw e.reason;
			default: switch (typeof e.status == "string" ? e.then(ne, ne) : (e.status = "pending", e.then(function(t) {
				e.status === "pending" && (e.status = "fulfilled", e.value = t);
			}, function(t) {
				e.status === "pending" && (e.status = "rejected", e.reason = t);
			})), e.status) {
				case "fulfilled": return e.value;
				case "rejected": throw e.reason;
			}
		}
		throw e;
	}
	function ue(e, r, i, a, o) {
		var s = typeof e;
		(s === "undefined" || s === "boolean") && (e = null);
		var c = !1;
		if (e === null) c = !0;
		else switch (s) {
			case "bigint":
			case "string":
			case "number":
				c = !0;
				break;
			case "object": switch (e.$$typeof) {
				case t:
				case n:
					c = !0;
					break;
				case d: return c = e._init, ue(c(e._payload), r, i, a, o);
			}
		}
		if (c) return o = o(e), c = a === "" ? "." + ce(e, 0) : a, x(o) ? (i = "", c != null && (i = c.replace(se, "$&/") + "/"), ue(o, r, i, "", function(e) {
			return e;
		})) : o != null && (ae(o) && (o = ie(o, i + (o.key == null || e && e.key === o.key ? "" : ("" + o.key).replace(se, "$&/") + "/") + c)), r.push(o)), 1;
		c = 0;
		var l = a === "" ? "." : a + ":";
		if (x(e)) for (var u = 0; u < e.length; u++) a = e[u], s = l + ce(a, u), c += ue(a, r, i, s, o);
		else if (u = h(e), typeof u == "function") for (e = u.call(e), u = 0; !(a = e.next()).done;) a = a.value, s = l + ce(a, u++), c += ue(a, r, i, s, o);
		else if (s === "object") {
			if (typeof e.then == "function") return ue(le(e), r, i, a, o);
			throw r = String(e), Error("Objects are not valid as a React child (found: " + (r === "[object Object]" ? "object with keys {" + Object.keys(e).join(", ") + "}" : r) + "). If you meant to render a collection of children, use an array instead.");
		}
		return c;
	}
	function w(e, t, n) {
		if (e == null) return e;
		var r = [], i = 0;
		return ue(e, r, "", "", function(e) {
			return t.call(n, e, i++);
		}), r;
	}
	function de(e) {
		if (e._status === -1) {
			var t = e._result, n = t();
			n.then(function(t) {
				(e._status === 0 || e._status === -1) && (e._status = 1, e._result = t, n.status === void 0 && (n.status = "fulfilled", n.value = t));
			}, function(t) {
				(e._status === 0 || e._status === -1) && (e._status = 2, e._result = t, n.status === void 0 && (n.status = "rejected", n.reason = t));
			}), e._status === -1 && (e._status = 0, e._result = n);
		}
		if (e._status === 1) return e._result.default;
		throw e._result;
	}
	var fe = typeof reportError == "function" ? reportError : function(e) {
		if (typeof window == "object" && typeof window.ErrorEvent == "function") {
			var t = new window.ErrorEvent("error", {
				bubbles: !0,
				cancelable: !0,
				message: typeof e == "object" && e && typeof e.message == "string" ? String(e.message) : String(e),
				error: e
			});
			if (!window.dispatchEvent(t)) return;
		} else if (typeof process == "object" && typeof process.emit == "function") {
			process.emit("uncaughtException", e);
			return;
		}
		console.error(e);
	};
	function pe(e) {
		var t = S.T, n = {};
		n.types = t === null ? null : t.types, S.T = n;
		try {
			var r = e(), i = S.S;
			i !== null && i(n, r), typeof r == "object" && r && typeof r.then == "function" && r.then(ne, fe);
		} catch (e) {
			fe(e);
		} finally {
			t !== null && n.types !== null && (t.types = n.types), S.T = t;
		}
	}
	function me(e) {
		var t = S.T;
		if (t !== null) {
			var n = t.types;
			n === null ? t.types = [e] : n.indexOf(e) === -1 && n.push(e);
		} else pe(me.bind(null, e));
	}
	var he = {
		map: w,
		forEach: function(e, t, n) {
			w(e, function() {
				t.apply(this, arguments);
			}, n);
		},
		count: function(e) {
			var t = 0;
			return w(e, function() {
				t++;
			}), t;
		},
		toArray: function(e) {
			return w(e, function(e) {
				return e;
			}) || [];
		},
		only: function(e) {
			if (!ae(e)) throw Error("React.Children.only expected to receive a single React element child.");
			return e;
		}
	};
	e.Activity = f, e.Children = he, e.Component = y, e.Fragment = r, e.Profiler = a, e.PureComponent = te, e.StrictMode = i, e.Suspense = l, e.ViewTransition = p, e.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = S, e.__COMPILER_RUNTIME = {
		__proto__: null,
		c: function(e) {
			return S.H.useMemoCache(e);
		}
	}, e.addTransitionType = me, e.cache = function(e) {
		return function() {
			return e.apply(null, arguments);
		};
	}, e.cacheSignal = function() {
		return null;
	}, e.cloneElement = function(e, t, n) {
		if (e == null) throw Error("The argument must be a React element, but you passed " + e + ".");
		var r = _({}, e.props), i = e.key;
		if (t != null) for (a in t.key !== void 0 && (i = "" + t.key), t) !C.call(t, a) || a === "key" || a === "__self" || a === "__source" || a === "ref" && t.ref === void 0 || (r[a] = t[a]);
		var a = arguments.length - 2;
		if (a === 1) r.children = n;
		else if (1 < a) {
			for (var o = Array(a), s = 0; s < a; s++) o[s] = arguments[s + 2];
			r.children = o;
		}
		return re(e.type, i, r);
	}, e.createContext = function(e) {
		return e = {
			$$typeof: s,
			_currentValue: e,
			_currentValue2: e,
			_threadCount: 0,
			Provider: null,
			Consumer: null
		}, e.Provider = e, e.Consumer = {
			$$typeof: o,
			_context: e
		}, e;
	}, e.createElement = function(e, t, n) {
		var r, i = {}, a = null;
		if (t != null) for (r in t.key !== void 0 && (a = "" + t.key), t) C.call(t, r) && r !== "key" && r !== "__self" && r !== "__source" && (i[r] = t[r]);
		var o = arguments.length - 2;
		if (o === 1) i.children = n;
		else if (1 < o) {
			for (var s = Array(o), c = 0; c < o; c++) s[c] = arguments[c + 2];
			i.children = s;
		}
		if (e && e.defaultProps) for (r in o = e.defaultProps, o) i[r] === void 0 && (i[r] = o[r]);
		return re(e, a, i);
	}, e.createRef = function() {
		return { current: null };
	}, e.forwardRef = function(e) {
		return {
			$$typeof: c,
			render: e
		};
	}, e.isValidElement = ae, e.lazy = function(e) {
		return {
			$$typeof: d,
			_payload: {
				_status: -1,
				_result: e
			},
			_init: de
		};
	}, e.memo = function(e, t) {
		return {
			$$typeof: u,
			type: e,
			compare: t === void 0 ? null : t
		};
	}, e.startTransition = pe, e.unstable_useCacheRefresh = function() {
		return S.H.useCacheRefresh();
	}, e.use = function(e) {
		return S.H.use(e);
	}, e.useActionState = function(e, t, n) {
		return S.H.useActionState(e, t, n);
	}, e.useCallback = function(e, t) {
		return S.H.useCallback(e, t);
	}, e.useContext = function(e) {
		return S.H.useContext(e);
	}, e.useDebugValue = function() {}, e.useDeferredValue = function(e, t) {
		return S.H.useDeferredValue(e, t);
	}, e.useEffect = function(e, t) {
		return S.H.useEffect(e, t);
	}, e.useEffectEvent = function(e) {
		return S.H.useEffectEvent(e);
	}, e.useId = function() {
		return S.H.useId();
	}, e.useImperativeHandle = function(e, t, n) {
		return S.H.useImperativeHandle(e, t, n);
	}, e.useInsertionEffect = function(e, t) {
		return S.H.useInsertionEffect(e, t);
	}, e.useLayoutEffect = function(e, t) {
		return S.H.useLayoutEffect(e, t);
	}, e.useMemo = function(e, t) {
		return S.H.useMemo(e, t);
	}, e.useOptimistic = function(e, t) {
		return S.H.useOptimistic(e, t);
	}, e.useReducer = function(e, t, n) {
		return S.H.useReducer(e, t, n);
	}, e.useRef = function(e) {
		return S.H.useRef(e);
	}, e.useState = function(e) {
		return S.H.useState(e);
	}, e.useSyncExternalStore = function(e, t, n) {
		return S.H.useSyncExternalStore(e, t, n);
	}, e.useTransition = function() {
		return S.H.useTransition();
	}, e.version = "19.3.0";
})), u = /* @__PURE__ */ o(((e, t) => {
	t.exports = l();
})), d;
try {
	d = new TextDecoder();
} catch {}
var f, p, m = 0, h = [], g = h, _ = 0, v = {}, y, ee, te = 0, b = 0, x, ne, S = [], C, re = {
	useRecords: !1,
	mapsAsObjects: !0
}, ie = class {}, ae = new ie();
ae.name = "MessagePack 0xC1";
var oe = !1, se = 2, ce = class e {
	constructor(e) {
		e && (e.useRecords === !1 && e.mapsAsObjects === void 0 && (e.mapsAsObjects = !0), e.sequential && e.trusted !== !1 && (e.trusted = !0, !e.structures && e.useRecords != 0 && (e.structures = [], e.maxSharedStructures ||= 0)), e.structures ? e.structures.sharedLength = e.structures.length : e.getStructures && ((e.structures = []).uninitialized = !0, e.structures.sharedLength = 0), e.int64AsNumber && (e.int64AsType = "number")), Object.assign(this, e);
	}
	unpack(t, n) {
		if (f) return Le(() => (Re(), this ? this.unpack(t, n) : e.prototype.unpack.call(re, t, n)));
		!t.buffer && t.constructor === ArrayBuffer && (t = typeof Buffer < "u" ? Buffer.from(t) : new Uint8Array(t)), typeof n == "object" ? (p = n.end || t.length, m = n.start || 0) : (m = 0, p = n > -1 ? n : t.length), _ = 0, b = 0, ee = null, g = h, x = null, f = t;
		try {
			C = t.dataView || (t.dataView = new DataView(t.buffer, t.byteOffset, t.byteLength));
		} catch (e) {
			throw f = null, t instanceof Uint8Array ? e : Error("Source must be a Uint8Array or Buffer but was a " + (t && typeof t == "object" ? t.constructor.name : typeof t));
		}
		if (this instanceof e) {
			if (v = this, this.structures) return y = this.structures, le(n);
			(!y || y.length > 0) && (y = []);
		} else v = re, (!y || y.length > 0) && (y = []);
		return le(n);
	}
	unpackMultiple(e, t) {
		let n, r = 0;
		try {
			oe = !0;
			let i = e.length, a = this ? this.unpack(e, i) : Be.unpack(e, i);
			if (t) {
				if (t(a, r, m) === !1) return;
				for (; m < i;) if (r = m, t(le(), r, m) === !1) return;
			} else {
				for (n = [a]; m < i;) r = m, n.push(le());
				return n;
			}
		} catch (e) {
			throw e.lastPosition = r, e.values = n, e;
		} finally {
			oe = !1, Re();
		}
	}
	_mergeStructures(e, t) {
		this._onLoadedStructures && (e = this._onLoadedStructures(e)), e ||= [], Object.isFrozen(e) && (e = e.map((e) => e.slice(0)));
		for (let t = 0, n = e.length; t < n; t++) {
			let n = e[t];
			n && (n.isShared = !0, t >= 32 && (n.highByte = t - 32 >> 5));
		}
		e.sharedLength = e.length;
		for (let n in t || []) if (n >= 0) {
			let r = e[n], i = t[n];
			i && (r && ((e.restoreStructures || (e.restoreStructures = []))[n] = r), e[n] = i);
		}
		return this.structures = e;
	}
	decode(e, t) {
		return this.unpack(e, t);
	}
};
function le(e) {
	try {
		if (!v.trusted && !oe) {
			let e = y.sharedLength || 0;
			e < y.length && (y.length = e);
		}
		let t;
		if (v._readStruct && f[m] < 64 && f[m] >= 32 ? (t = v._readStruct(f, m, p), f = null, !(e && e.lazy) && t && (t = t.toJSON()), m = p) : t = w(), x &&= (m = x.postBundlePosition, null), oe && (y.restoreStructures = null), m == p) y && y.restoreStructures && ue(), y = null, f = null, ne &&= null;
		else if (m > p) throw Error("Unexpected end of MessagePack data");
		else if (!oe) {
			let e;
			try {
				e = JSON.stringify(t, (e, t) => typeof t == "bigint" ? `${t}n` : t).slice(0, 100);
			} catch (t) {
				e = "(JSON view not available " + t + ")";
			}
			throw Error("Data read, but end of buffer not reached " + e);
		}
		return t;
	} catch (e) {
		throw y && y.restoreStructures && ue(), Re(), (e instanceof RangeError || e.message.startsWith("Unexpected end of buffer") || m > p) && (e.incomplete = !0), e;
	}
}
function ue() {
	for (let e in y.restoreStructures) y[e] = y.restoreStructures[e];
	y.restoreStructures = null;
}
function w() {
	let e = f[m++];
	if (e < 160) {
		if (e < 128) {
			if (e < 64) return e;
			{
				let t = y[e & 63] || v.getStructures && me()[e & 63];
				return t ? (t.read ||= fe(t, e & 63), t.read()) : e;
			}
		}
		if (e < 144) {
			if (e -= 128, v.mapsAsObjects) {
				let t = {};
				for (let n = 0; n < e; n++) {
					let e = Ae();
					e === "__proto__" && (e = "__proto_"), t[e] = w();
				}
				return t;
			}
			{
				let t = /* @__PURE__ */ new Map();
				for (let n = 0; n < e; n++) t.set(w(), w());
				return t;
			}
		}
		{
			e -= 144;
			let t = Array(e);
			for (let n = 0; n < e; n++) t[n] = w();
			return v.freezeData ? Object.freeze(t) : t;
		}
	}
	if (e < 192) {
		let t = e - 160;
		if (b >= m) return ee.slice(m - te, (m += t) - te);
		if (b == 0 && p < 140) {
			let e = t < 16 ? Te(t) : we(t);
			if (e != null) return e;
		}
		return he(t);
	}
	{
		let t;
		switch (e) {
			case 192: return null;
			case 193: return x ? (t = w(), t > 0 ? x[1].slice(x.position1, x.position1 += t) : x[0].slice(x.position0, x.position0 -= t)) : ae;
			case 194: return !1;
			case 195: return !0;
			case 196:
				if (t = f[m++], t === void 0) throw Error("Unexpected end of buffer");
				return De(t);
			case 197: return t = C.getUint16(m), m += 2, De(t);
			case 198: return t = C.getUint32(m), m += 4, De(t);
			case 199: return Oe(f[m++]);
			case 200: return t = C.getUint16(m), m += 2, Oe(t);
			case 201: return t = C.getUint32(m), m += 4, Oe(t);
			case 202:
				if (t = C.getFloat32(m), v.useFloat32 > 2) {
					let e = ze[(f[m] & 127) << 1 | f[m + 1] >> 7];
					return m += 4, (e * t + (t > 0 ? .5 : -.5) >> 0) / e;
				}
				return m += 4, t;
			case 203: return t = C.getFloat64(m), m += 8, t;
			case 204: return f[m++];
			case 205: return t = C.getUint16(m), m += 2, t;
			case 206: return t = C.getUint32(m), m += 4, t;
			case 207: return v.int64AsType === "number" ? (t = C.getUint32(m) * 4294967296, t += C.getUint32(m + 4)) : v.int64AsType === "string" ? t = C.getBigUint64(m).toString() : v.int64AsType === "auto" ? (t = C.getBigUint64(m), t <= BigInt(2) << BigInt(52) && (t = Number(t))) : t = C.getBigUint64(m), m += 8, t;
			case 208: return C.getInt8(m++);
			case 209: return t = C.getInt16(m), m += 2, t;
			case 210: return t = C.getInt32(m), m += 4, t;
			case 211: return v.int64AsType === "number" ? (t = C.getInt32(m) * 4294967296, t += C.getUint32(m + 4)) : v.int64AsType === "string" ? t = C.getBigInt64(m).toString() : v.int64AsType === "auto" ? (t = C.getBigInt64(m), t >= BigInt(-2) << BigInt(52) && t <= BigInt(2) << BigInt(52) && (t = Number(t))) : t = C.getBigInt64(m), m += 8, t;
			case 212:
				if (t = f[m++], t == 114) return Me(f[m++] & 63);
				{
					let e = S[t];
					if (e) return e.read ? (m++, e.read(w())) : e.noBuffer ? (m++, e()) : e(f.subarray(m, ++m));
					throw Error("Unknown extension " + t);
				}
			case 213: return t = f[m], t == 114 ? (m++, Me(f[m++] & 63, f[m++])) : Oe(2);
			case 214: return Oe(4);
			case 215: return Oe(8);
			case 216: return Oe(16);
			case 217: return t = f[m++], b >= m ? ee.slice(m - te, (m += t) - te) : ge(t);
			case 218: return t = C.getUint16(m), m += 2, b >= m ? ee.slice(m - te, (m += t) - te) : _e(t);
			case 219: return t = C.getUint32(m), m += 4, b >= m ? ee.slice(m - te, (m += t) - te) : ve(t);
			case 220: return t = C.getUint16(m), m += 2, xe(t);
			case 221: return t = C.getUint32(m), m += 4, xe(t);
			case 222: return t = C.getUint16(m), m += 2, Se(t);
			case 223: return t = C.getUint32(m), m += 4, Se(t);
			default:
				if (e >= 224) return e - 256;
				throw e === void 0 ? be() : Error("Unknown MessagePack token " + e);
		}
	}
}
var de = /^[a-zA-Z_$][a-zA-Z\d_$]*$/;
function fe(e, t) {
	function n() {
		if (n.count++ > se) {
			let r;
			try {
				r = e.read = Function("r", "return function(){return " + (v.freezeData ? "Object.freeze" : "") + "({" + e.map((e) => e === "__proto__" ? "__proto_:r()" : de.test(e) ? e + ":r()" : "[" + JSON.stringify(e) + "]:r()").join(",") + "})}")(w);
			} catch {
				return se = Infinity, n();
			}
			return e.read0 = r, e.highByte === 0 && (e.read = pe(t, e.read)), r();
		}
		let r = {};
		for (let t = 0, n = e.length; t < n; t++) {
			let n = e[t];
			n === "__proto__" && (n = "__proto_"), r[n] = w();
		}
		return v.freezeData ? Object.freeze(r) : r;
	}
	return n.count = 0, e.read0 = n, e.highByte === 0 ? pe(t, n) : n;
}
var pe = (e, t) => function() {
	let n = f[m++];
	if (n === 0) return t();
	let r = e < 32 ? -(e + (n << 5)) : e + (n << 5), i = y[r] || me()[r];
	if (!i) throw Error("Record id is not defined for " + r);
	return i.read ||= fe(i, e), i.read();
};
function me() {
	let e = Le(() => (f = null, v.getStructures()));
	return y = v._mergeStructures(e, y);
}
var he = ye, ge = ye, _e = ye, ve = ye;
function ye(e) {
	let t;
	if (e < 16 && (t = Te(e))) return t;
	if (e > 64 && d) return d.decode(f.subarray(m, m += e));
	let n = m + e, r = [];
	for (t = ""; m < n;) {
		let e = f[m++];
		if (!(e & 128)) r.push(e);
		else if ((e & 224) == 192) {
			if (e < 194 || m >= n || (f[m] & 192) != 128) r.push(65533);
			else {
				let t = f[m++] & 63;
				r.push((e & 31) << 6 | t);
			}
		} else if ((e & 240) == 224) {
			let t = m < n ? f[m] : 0;
			if (m >= n || (t & 192) != 128 || e === 224 && t < 160 || e === 237 && t >= 160) r.push(65533);
			else if (m++, m >= n || (f[m] & 192) != 128) r.push(65533);
			else {
				let n = f[m++] & 63;
				r.push((e & 31) << 12 | (t & 63) << 6 | n);
			}
		} else if ((e & 248) == 240) {
			let t = m < n ? f[m] : 0;
			if (e > 244 || m >= n || (t & 192) != 128 || e === 240 && t < 144 || e === 244 && t >= 144) r.push(65533);
			else if (m++, m >= n || (f[m] & 192) != 128) r.push(65533);
			else {
				let i = f[m++] & 63;
				if (m >= n || (f[m] & 192) != 128) r.push(65533);
				else {
					let n = f[m++] & 63, a = (e & 7) << 18 | (t & 63) << 12 | i << 6 | n;
					a -= 65536, r.push(a >>> 10 & 1023 | 55296), r.push(56320 | a & 1023);
				}
			}
		} else r.push(65533);
		r.length >= 4096 && (t += Ce.apply(String, r), r.length = 0);
	}
	return r.length > 0 && (t += Ce.apply(String, r)), t;
}
function be() {
	let e = /* @__PURE__ */ Error("Unexpected end of MessagePack data");
	return e.incomplete = !0, e;
}
function xe(e) {
	if (e > p - m) throw be();
	let t = Array(e);
	for (let n = 0; n < e; n++) t[n] = w();
	return v.freezeData ? Object.freeze(t) : t;
}
function Se(e) {
	if (e > (p - m) / 2) throw be();
	if (v.mapsAsObjects) {
		let t = {};
		for (let n = 0; n < e; n++) {
			let e = Ae();
			e === "__proto__" && (e = "__proto_"), t[e] = w();
		}
		return t;
	}
	{
		let t = /* @__PURE__ */ new Map();
		for (let n = 0; n < e; n++) t.set(w(), w());
		return t;
	}
}
var Ce = String.fromCharCode;
function we(e) {
	let t = m, n = Array(e);
	for (let r = 0; r < e; r++) {
		let e = f[m++];
		if ((e & 128) > 0) {
			m = t;
			return;
		}
		n[r] = e;
	}
	return Ce.apply(String, n);
}
function Te(e) {
	if (e < 4) {
		if (e < 2) {
			if (e === 0) return "";
			{
				let e = f[m++];
				if ((e & 128) > 1) {
					--m;
					return;
				}
				return Ce(e);
			}
		}
		{
			let t = f[m++], n = f[m++];
			if ((t & 128) > 0 || (n & 128) > 0) {
				m -= 2;
				return;
			}
			if (e < 3) return Ce(t, n);
			let r = f[m++];
			if ((r & 128) > 0) {
				m -= 3;
				return;
			}
			return Ce(t, n, r);
		}
	}
	{
		let t = f[m++], n = f[m++], r = f[m++], i = f[m++];
		if ((t & 128) > 0 || (n & 128) > 0 || (r & 128) > 0 || (i & 128) > 0) {
			m -= 4;
			return;
		}
		if (e < 6) {
			if (e === 4) return Ce(t, n, r, i);
			{
				let e = f[m++];
				if ((e & 128) > 0) {
					m -= 5;
					return;
				}
				return Ce(t, n, r, i, e);
			}
		}
		if (e < 8) {
			let a = f[m++], o = f[m++];
			if ((a & 128) > 0 || (o & 128) > 0) {
				m -= 6;
				return;
			}
			if (e < 7) return Ce(t, n, r, i, a, o);
			let s = f[m++];
			if ((s & 128) > 0) {
				m -= 7;
				return;
			}
			return Ce(t, n, r, i, a, o, s);
		}
		{
			let a = f[m++], o = f[m++], s = f[m++], c = f[m++];
			if ((a & 128) > 0 || (o & 128) > 0 || (s & 128) > 0 || (c & 128) > 0) {
				m -= 8;
				return;
			}
			if (e < 10) {
				if (e === 8) return Ce(t, n, r, i, a, o, s, c);
				{
					let e = f[m++];
					if ((e & 128) > 0) {
						m -= 9;
						return;
					}
					return Ce(t, n, r, i, a, o, s, c, e);
				}
			}
			if (e < 12) {
				let l = f[m++], u = f[m++];
				if ((l & 128) > 0 || (u & 128) > 0) {
					m -= 10;
					return;
				}
				if (e < 11) return Ce(t, n, r, i, a, o, s, c, l, u);
				let d = f[m++];
				if ((d & 128) > 0) {
					m -= 11;
					return;
				}
				return Ce(t, n, r, i, a, o, s, c, l, u, d);
			}
			{
				let l = f[m++], u = f[m++], d = f[m++], p = f[m++];
				if ((l & 128) > 0 || (u & 128) > 0 || (d & 128) > 0 || (p & 128) > 0) {
					m -= 12;
					return;
				}
				if (e < 14) {
					if (e === 12) return Ce(t, n, r, i, a, o, s, c, l, u, d, p);
					{
						let e = f[m++];
						if ((e & 128) > 0) {
							m -= 13;
							return;
						}
						return Ce(t, n, r, i, a, o, s, c, l, u, d, p, e);
					}
				}
				{
					let h = f[m++], g = f[m++];
					if ((h & 128) > 0 || (g & 128) > 0) {
						m -= 14;
						return;
					}
					if (e < 15) return Ce(t, n, r, i, a, o, s, c, l, u, d, p, h, g);
					let _ = f[m++];
					if ((_ & 128) > 0) {
						m -= 15;
						return;
					}
					return Ce(t, n, r, i, a, o, s, c, l, u, d, p, h, g, _);
				}
			}
		}
	}
}
function Ee() {
	let e = f[m++], t;
	if (e < 192) t = e - 160;
	else switch (e) {
		case 217:
			t = f[m++];
			break;
		case 218:
			t = C.getUint16(m), m += 2;
			break;
		case 219:
			t = C.getUint32(m), m += 4;
			break;
		default: throw Error("Expected string");
	}
	return ye(t);
}
function De(e) {
	return v.copyBuffers ? Uint8Array.prototype.slice.call(f, m, m += e) : f.subarray(m, m += e);
}
function Oe(e) {
	let t = f[m++];
	if (S[t]) {
		let n;
		return S[t](f.subarray(m, n = m += e), (e) => {
			m = e;
			try {
				return w();
			} finally {
				m = n;
			}
		});
	}
	throw Error("Unknown extension type " + t);
}
var ke = Array(4096);
function Ae() {
	let e = f[m++];
	if (e >= 160 && e < 192) {
		if (e -= 160, b >= m) return ee.slice(m - te, (m += e) - te);
		if (!(b == 0 && p < 180)) return he(e);
	} else return m--, je(w());
	let t = (e << 5 ^ (e > 1 ? C.getUint16(m) : e > 0 ? f[m] : 0)) & 4095, n = ke[t], r = m, i = m + e - 3, a, o = 0;
	if (n && n.bytes == e) {
		for (; r < i;) {
			if (a = C.getUint32(r), a != n[o++]) {
				r = 1879048192;
				break;
			}
			r += 4;
		}
		for (i += 3; r < i;) if (a = f[r++], a != n[o++]) {
			r = 1879048192;
			break;
		}
		if (r === i) return m = r, n.string;
		i -= 3, r = m;
	}
	for (n = [], ke[t] = n, n.bytes = e; r < i;) a = C.getUint32(r), n.push(a), r += 4;
	for (i += 3; r < i;) a = f[r++], n.push(a);
	let s = e < 16 ? Te(e) : we(e);
	return s == null ? n.string = he(e) : n.string = s;
}
function je(e) {
	if (typeof e == "string") return e;
	if (typeof e == "number" || typeof e == "boolean" || typeof e == "bigint") return e.toString();
	if (e == null) return e + "";
	if (v.allowArraysInMapKeys && Array.isArray(e) && e.flat().every((e) => [
		"string",
		"number",
		"boolean",
		"bigint"
	].includes(typeof e))) return e.flat().toString();
	throw Error(`Invalid property type for record: ${typeof e}`);
}
var Me = (e, t) => {
	let n = w().map(je), r = e;
	t !== void 0 && (e = e < 32 ? -((t << 5) + e) : (t << 5) + e, n.highByte = t);
	let i = y[e];
	return i && (i.isShared || oe) && ((y.restoreStructures || (y.restoreStructures = []))[e] = i), y[e] = n, n.read = fe(n, r), (n.read0 || n.read)();
};
S[0] = () => {}, S[0].noBuffer = !0, S[66] = (e) => {
	let t = e.byteLength % 8 || 8, n = BigInt(e[0] & 128 ? e[0] - 256 : e[0]);
	for (let r = 1; r < t; r++) n <<= BigInt(8), n += BigInt(e[r]);
	if (e.byteLength !== t) {
		let r = new DataView(e.buffer, e.byteOffset, e.byteLength), i = (e, t) => {
			let n = t - e;
			if (n <= 40) {
				let n = r.getBigUint64(e);
				for (let i = e + 8; i < t; i += 8) n <<= BigInt(64), n |= r.getBigUint64(i);
				return n;
			}
			let a = e + (n >> 4 << 3), o = i(e, a), s = i(a, t);
			return o << BigInt((t - a) * 8) | s;
		};
		n = n << BigInt((r.byteLength - t) * 8) | i(t, r.byteLength);
	}
	return n;
};
var Ne = {
	Error,
	EvalError,
	RangeError,
	ReferenceError,
	SyntaxError,
	TypeError,
	URIError,
	AggregateError: typeof AggregateError == "function" ? AggregateError : null
};
S[101] = () => {
	let e = w();
	if (!Ne[e[0]]) {
		let t = Error(e[1], { cause: e[2] });
		return t.name = e[0], t;
	}
	return Ne[e[0]](e[1], { cause: e[2] });
}, S[105] = (e) => {
	if (v.structuredClone === !1) throw Error("Structured clone extension is disabled");
	let t = C.getUint32(m - 4);
	ne ||= /* @__PURE__ */ new Map();
	let n = f[m], r;
	r = n >= 144 && n < 160 || n == 220 || n == 221 ? [] : n >= 128 && n < 144 || n == 222 || n == 223 ? /* @__PURE__ */ new Map() : (n >= 199 && n <= 201 || n >= 212 && n <= 216) && f[m + 1] === 115 ? /* @__PURE__ */ new Set() : {};
	let i = { target: r };
	ne.set(t, i);
	let a = w();
	if (i.used) Object.assign(r, a);
	else return i.target = a;
	if (r instanceof Map) for (let [e, t] of a.entries()) r.set(e, t);
	if (r instanceof Set) for (let e of Array.from(a)) r.add(e);
	return r;
}, S[112] = (e) => {
	if (v.structuredClone === !1) throw Error("Structured clone extension is disabled");
	let t = C.getUint32(m - 4), n = ne.get(t);
	return n.used = !0, n.target;
}, S[115] = () => new Set(w());
var Pe = [
	"Int8",
	"Uint8",
	"Uint8Clamped",
	"Int16",
	"Uint16",
	"Int32",
	"Uint32",
	"Float32",
	"Float64",
	"BigInt64",
	"BigUint64"
].map((e) => e + "Array"), Fe = typeof globalThis == "object" ? globalThis : window;
S[116] = (e) => {
	let t = e[0], n = Uint8Array.prototype.slice.call(e, 1).buffer, r = Pe[t];
	if (!r) {
		if (t === 16) return n;
		if (t === 17) return new DataView(n);
		throw Error("Could not find typed array for code " + t);
	}
	return new Fe[r](n);
}, S[120] = () => {
	let e = w();
	return new RegExp(e[0], e[1]);
};
var Ie = [];
S[98] = (e) => {
	let t = (e[0] << 24) + (e[1] << 16) + (e[2] << 8) + e[3], n = m;
	return m += t - e.length, x = Ie, x = [Ee(), Ee()], x.position0 = 0, x.position1 = 0, x.postBundlePosition = m, m = n, w();
}, S[255] = (e) => e.length == 4 ? /* @__PURE__ */ new Date((e[0] * 16777216 + (e[1] << 16) + (e[2] << 8) + e[3]) * 1e3) : e.length == 8 ? /* @__PURE__ */ new Date(((e[0] << 22) + (e[1] << 14) + (e[2] << 6) + (e[3] >> 2)) / 1e6 + ((e[3] & 3) * 4294967296 + e[4] * 16777216 + (e[5] << 16) + (e[6] << 8) + e[7]) * 1e3) : e.length == 12 ? /* @__PURE__ */ new Date(((e[0] << 24) + (e[1] << 16) + (e[2] << 8) + e[3]) / 1e6 + ((e[4] & 128 ? -281474976710656 : 0) + e[6] * 1099511627776 + e[7] * 4294967296 + e[8] * 16777216 + (e[9] << 16) + (e[10] << 8) + e[11]) * 1e3) : /* @__PURE__ */ new Date("invalid");
function Le(e) {
	v && v._onSaveState && v._onSaveState();
	let t = p, n = m, r = _, i = te, a = b, o = ee, s = g, c = ne, l = x, u = new Uint8Array(f.slice(0, p)), d = y, h = y.slice(0, y.length), S = v, re = oe, ie = e();
	return p = t, m = n, _ = r, te = i, b = a, ee = o, g = s, ne = c, x = l, f = u, oe = re, y = d, y.splice(0, y.length, ...h), v = S, C = new DataView(f.buffer, f.byteOffset, f.byteLength), ie;
}
function Re() {
	f = null, ne = null, y = null;
}
var ze = Array(147);
for (let e = 0; e < 256; e++) ze[e] = +("1e" + Math.floor(45.15 - e * .30103));
var Be = new ce({ useRecords: !1 });
Be.unpack, Be.unpackMultiple, Be.unpack;
var Ve = {
	NEVER: 0,
	ALWAYS: 1,
	DECIMAL_ROUND: 3,
	DECIMAL_FIT: 4
};
new Uint8Array((/* @__PURE__ */ new Float32Array(1)).buffer, 0, 4), ce.SUPPORTS_STRUCT_HOOKS = !0;
//#endregion
//#region ../../node_modules/msgpackr/pack.js
var He;
try {
	He = new TextEncoder();
} catch {}
var Ue, We, Ge = typeof Buffer < "u", Ke = Ge ? function(e) {
	return Buffer.allocUnsafeSlow(e);
} : Uint8Array, qe = Ge ? Buffer : Uint8Array, Je = Ge ? 4294967296 : 2144337920, T, Ye, E, D = 0, Xe, O = null, Ze = 21760, Qe = /[\u0080-\uFFFF]/, $e = Symbol("record-id"), et = class extends ce {
	constructor(e) {
		super(e), this.offset = 0;
		let t, n, r, i, a = qe.prototype.utf8Write ? function(e, t) {
			return T.utf8Write(e, t, T.byteLength - t);
		} : He && He.encodeInto ? function(e, t) {
			return He.encodeInto(e, T.subarray(t)).written;
		} : !1, o = this;
		e ||= {};
		let s = e && e.sequential, c = e.structures || e.saveStructures, l = e.maxSharedStructures;
		if (l ??= c ? 32 : 0, l > 8160) throw Error("Maximum maxSharedStructure is 8160");
		e.structuredClone && e.moreTypes == null && (this.moreTypes = !0);
		let u = e.maxOwnStructures;
		u ??= c ? 32 : 64, !this.structures && e.useRecords != 0 && (this.structures = []);
		let d = l > 32 || u + l > 64, f = l + 64, p = l + u + 64;
		if (p > 8256) throw Error("Maximum maxSharedStructure + maxOwnStructure is 8192");
		let m = [], h = 0, g = 0;
		this.pack = this.encode = function(e, a) {
			if (T || (T = new Ke(8192), E = T.dataView || (T.dataView = new DataView(T.buffer, 0, 8192)), D = 0), Xe = T.length - 10, Xe - D < 2048 ? (T = new Ke(T.length), E = T.dataView || (T.dataView = new DataView(T.buffer, 0, T.length)), Xe = T.length - 10, D = 0) : D = D + 7 & 2147483640, t = D, a & 2048 && (D += a & 255), i = o.structuredClone ? /* @__PURE__ */ new Map() : null, o.bundleStrings && typeof e != "string" ? (O = [], O.size = Infinity) : O = null, r = o.structures, r) {
				r.uninitialized && (r = o._mergeStructures(o.getStructures()));
				let e = r.sharedLength || 0;
				if (e > l) throw Error("Shared structures is larger than maximum shared structures, try increasing maxSharedStructures to " + r.sharedLength);
				if (!r.transitions) {
					r.transitions = Object.create(null);
					for (let t = 0; t < e; t++) {
						let e = r[t];
						if (!e) continue;
						let n, i = r.transitions;
						for (let t = 0, r = e.length; t < r; t++) {
							let r = e[t];
							n = i[r], n ||= i[r] = Object.create(null), i = n;
						}
						i[$e] = t + 64;
					}
					this.lastNamedStructuresLength = e;
				}
				s || (r.nextId = e + 64);
			}
			n &&= !1;
			let c;
			try {
				o._writeStruct && e && typeof e == "object" ? e.constructor === Object ? ne(e) : e.constructor !== Map && !Array.isArray(e) && !We.some((t) => e instanceof t) ? ne(o.useToJSON !== !1 && e.toJSON ? e.toJSON() : e) : y(e) : y(e);
				let n = O;
				if (O && at(t, y, 0), i && i.idsToInsert) {
					let e = i.idsToInsert.sort((e, t) => e.offset > t.offset ? 1 : -1), r = e.length, a = -1;
					for (; n && r > 0;) {
						let i = e[--r].offset + t;
						i < n.stringsPosition + t && a === -1 && (a = 0), i > n.position + t ? a >= 0 && (a += 6) : (a >= 0 && (E.setUint32(n.position + t, E.getUint32(n.position + t) + a), a = -1), n = n.previous, r++);
					}
					a >= 0 && n && E.setUint32(n.position + t, E.getUint32(n.position + t) + a), D += e.length * 6, D > Xe && S(D), o.offset = D;
					let s = it(T.subarray(t, D), e);
					return i = null, s;
				}
				return o.offset = D, a & 512 ? (T.start = t, T.end = D, T) : T.subarray(t, D);
			} catch (e) {
				throw c = e, e;
			} finally {
				if (r && (_(), n && o.saveStructures)) {
					let n = r.sharedLength || 0, i = T.subarray(t, D), s = (o._prepareStructures || ot)(r, o);
					if (!c) return o.saveStructures(s, s.isCompatible) === !1 ? (r.uninitialized = !0, o.pack(e, a)) : (o.lastNamedStructuresLength = n, T.length > 1073741824 && (T = null), i);
				}
				T.length > 1073741824 && (T = null), a & 1024 && (D = t);
			}
		};
		let _ = () => {
			g < 10 && g++;
			let e = r.sharedLength || 0;
			if (r.length > e && !s && (r.length = e), h > 1e4) r.transitions = null, g = 0, h = 0, m.length > 0 && (m = []);
			else if (m.length > 0 && !s) {
				for (let e = 0, t = m.length; e < t; e++) m[e][$e] = 0;
				m = [];
			}
		}, v = (e) => {
			var t = e.length;
			t < 16 ? T[D++] = 144 | t : t < 65536 ? (T[D++] = 220, T[D++] = t >> 8, T[D++] = t & 255) : (T[D++] = 221, E.setUint32(D, t), D += 4);
			for (let n = 0; n < t; n++) y(e[n]);
		}, y = (e) => {
			D > Xe && (T = S(D));
			var n = typeof e, r;
			if (n === "string") {
				let n = e.length;
				if (O && n >= 4 && n < 4096) {
					if ((O.size += n) > Ze) {
						let e, n = (O[0] ? O[0].length * 3 + O[1].length : 0) + 10;
						D + n > Xe && (T = S(D + n));
						let r;
						O.position ? (r = O, T[D] = 200, D += 3, T[D++] = 98, e = D - t, D += 4, at(t, y, 0), E.setUint16(e + t - 3, D - t - e)) : (T[D++] = 214, T[D++] = 98, e = D - t, D += 4), O = ["", ""], O.previous = r, O.size = 0, O.position = e;
					}
					let r = Qe.test(e);
					O[+!r] += e, T[D++] = 193, y(r ? -n : n);
					return;
				}
				let i;
				i = n < 32 ? 1 : n < 256 ? 2 : n < 65536 ? 3 : 5;
				let o = n * 3;
				if (D + o > Xe && (T = S(D + o)), n < 64 || !a) {
					let t, a, o, s = D + i;
					for (t = 0; t < n; t++) a = e.charCodeAt(t), a < 128 ? T[s++] = a : a < 2048 ? (T[s++] = a >> 6 | 192, T[s++] = a & 63 | 128) : (a & 64512) == 55296 && ((o = e.charCodeAt(t + 1)) & 64512) == 56320 ? (a = 65536 + ((a & 1023) << 10) + (o & 1023), t++, T[s++] = a >> 18 | 240, T[s++] = a >> 12 & 63 | 128, T[s++] = a >> 6 & 63 | 128, T[s++] = a & 63 | 128) : (T[s++] = a >> 12 | 224, T[s++] = a >> 6 & 63 | 128, T[s++] = a & 63 | 128);
					r = s - D - i;
				} else r = a(e, D + i);
				r < 32 ? T[D++] = 160 | r : r < 256 ? (i < 2 && T.copyWithin(D + 2, D + 1, D + 1 + r), T[D++] = 217, T[D++] = r) : r < 65536 ? (i < 3 && T.copyWithin(D + 3, D + 2, D + 2 + r), T[D++] = 218, T[D++] = r >> 8, T[D++] = r & 255) : (i < 5 && T.copyWithin(D + 5, D + 3, D + 3 + r), T[D++] = 219, E.setUint32(D, r), D += 4), D += r;
			} else if (n === "number") {
				if (e >>> 0 === e) e < 32 || e < 128 && this.useRecords === !1 || e < 64 && !this._writeStruct ? T[D++] = e : e < 256 ? (T[D++] = 204, T[D++] = e) : e < 65536 ? (T[D++] = 205, T[D++] = e >> 8, T[D++] = e & 255) : (T[D++] = 206, E.setUint32(D, e), D += 4);
				else if (e >> 0 === e) e >= -32 ? T[D++] = 256 + e : e >= -128 ? (T[D++] = 208, T[D++] = e + 256) : e >= -32768 ? (T[D++] = 209, E.setInt16(D, e), D += 2) : (T[D++] = 210, E.setInt32(D, e), D += 4);
				else {
					let t;
					if ((t = this.useFloat32) > 0 && e < 4294967296 && e >= -2147483648) {
						T[D++] = 202, E.setFloat32(D, e);
						let n;
						if (t < 4 || (n = e * ze[(T[D] & 127) << 1 | T[D + 1] >> 7]) >> 0 === n) {
							D += 4;
							return;
						}
						D--;
					}
					T[D++] = 203, E.setFloat64(D, e), D += 8;
				}
			} else if (n === "object" || n === "function") {
				if (!e) T[D++] = 192;
				else {
					if (i) {
						let n = i.get(e);
						if (n) {
							n.id ||= (i.idsToInsert || (i.idsToInsert = [])).push(n), T[D++] = 214, T[D++] = 112, E.setUint32(D, n.id), D += 4;
							return;
						}
						i.set(e, { offset: D - t });
					}
					let a = e.constructor;
					if (a === Object) x(e);
					else if (a === Array) v(e);
					else if (a === Map) {
						if (this.mapAsEmptyObject) T[D++] = 128;
						else {
							r = e.size, r < 16 ? T[D++] = 128 | r : r < 65536 ? (T[D++] = 222, T[D++] = r >> 8, T[D++] = r & 255) : (T[D++] = 223, E.setUint32(D, r), D += 4);
							for (let [t, n] of e) y(t), y(n);
						}
					} else {
						for (let t = 0, n = Ue.length; t < n; t++) {
							let n = We[t];
							if (e instanceof n) {
								let n = Ue[t];
								if (n.write) {
									n.type && (T[D++] = 212, T[D++] = n.type, T[D++] = 0);
									let t = n.write.call(this, e);
									t === e ? Array.isArray(e) ? v(e) : x(e) : y(t);
									return;
								}
								let r = T, i = E, a = D;
								T = null;
								let o;
								try {
									o = n.pack.call(this, e, (e) => (T = r, r = null, D += e, D > Xe && S(D), {
										target: T,
										targetView: E,
										position: D - e
									}), y);
								} finally {
									r && (T = r, E = i, D = a, Xe = T.length - 10);
								}
								o && (o.length + D > Xe && S(o.length + D), D = rt(o, T, D, n.type));
								return;
							}
						}
						if (Array.isArray(e)) v(e);
						else {
							if (o.useToJSON !== !1 && e.toJSON) {
								let t = e.toJSON();
								if (t !== e) return y(t);
							}
							if (n === "function") return y(this.writeFunction && this.writeFunction(e));
							x(e);
						}
					}
				}
			} else if (n === "boolean") T[D++] = e ? 195 : 194;
			else if (n === "bigint") {
				if (e < 0x8000000000000000 && e >= -0x8000000000000000) T[D++] = 211, E.setBigInt64(D, e);
				else if (e < 0x10000000000000000 && e > 0) T[D++] = 207, E.setBigUint64(D, e);
				else if (this.largeBigIntToFloat) T[D++] = 203, E.setFloat64(D, Number(e));
				else if (this.largeBigIntToString) return y(e.toString());
				else if (this.useBigIntExtension || this.moreTypes) {
					let t = BigInt(e < 0 ? -1 : 0), n;
					if (e >> BigInt(65536) === t) {
						let r = BigInt(0x10000000000000000) - BigInt(1), i = [];
						for (; i.push(e & r), e >> BigInt(63) !== t;) e >>= BigInt(64);
						n = new Uint8Array(new BigUint64Array(i).buffer), n.reverse();
					} else {
						let t = e < 0, r = (t ? ~e : e).toString(16);
						if (r.length % 2 ? r = "0" + r : parseInt(r.charAt(0), 16) >= 8 && (r = "00" + r), Ge) n = Buffer.from(r, "hex");
						else {
							n = new Uint8Array(r.length / 2);
							for (let e = 0; e < n.length; e++) n[e] = parseInt(r.slice(e * 2, e * 2 + 2), 16);
						}
						if (t) for (let e = 0; e < n.length; e++) n[e] = ~n[e];
					}
					n.length + D > Xe && S(n.length + D), D = rt(n, T, D, 66);
					return;
				} else throw RangeError(e + " was too large to fit in MessagePack 64-bit integer format, use useBigIntExtension, or set largeBigIntToFloat to convert to float-64, or set largeBigIntToString to convert to string");
				D += 8;
			} else if (n === "undefined") this.encodeUndefinedAsNil ? T[D++] = 192 : (T[D++] = 212, T[D++] = 0, T[D++] = 0);
			else throw Error("Unknown type: " + n);
		}, ee = this.variableMapSize || this.coercibleKeyAsNumber || this.skipValues ? (e) => {
			let t;
			if (this.skipValues) {
				t = [];
				for (let n in e) (typeof e.hasOwnProperty != "function" || e.hasOwnProperty(n)) && !this.skipValues.includes(e[n]) && t.push(n);
			} else t = Object.keys(e);
			let n = t.length;
			n < 16 ? T[D++] = 128 | n : n < 65536 ? (T[D++] = 222, T[D++] = n >> 8, T[D++] = n & 255) : (T[D++] = 223, E.setUint32(D, n), D += 4);
			let r;
			if (this.coercibleKeyAsNumber) for (let i = 0; i < n; i++) {
				r = t[i];
				let n = Number(r);
				y(isNaN(n) ? r : n), y(e[r]);
			}
			else for (let i = 0; i < n; i++) y(r = t[i]), y(e[r]);
		} : (e) => {
			T[D++] = 222;
			let n = D - t;
			D += 2;
			let r = 0;
			for (let t in e) (typeof e.hasOwnProperty != "function" || e.hasOwnProperty(t)) && (y(t), y(e[t]), r++);
			if (r > 65535) throw Error("Object is too large to serialize with fast 16-bit map size, use the \"variableMapSize\" option to serialize this object");
			T[n++ + t] = r >> 8, T[n + t] = r & 255;
		}, te = this.useRecords === !1 ? ee : e.progressiveRecords && !d ? (e) => {
			let n, i = r.transitions || (r.transitions = Object.create(null)), a = D++ - t, o;
			for (let s in e) if (typeof e.hasOwnProperty != "function" || e.hasOwnProperty(s)) {
				if (n = i[s], n) i = n;
				else {
					let c = Object.keys(e), l = i;
					i = r.transitions;
					let u = 0;
					for (let e = 0, t = c.length; e < t; e++) {
						let t = c[e];
						n = i[t], n || (n = i[t] = Object.create(null), u++), i = n;
					}
					a + t + 1 == D ? (D--, C(i, c, u)) : re(i, c, a, u), o = !0, i = l[s];
				}
				y(e[s]);
			}
			if (!o) {
				let n = i[$e];
				n ? T[a + t] = n : re(i, Object.keys(e), a, 0);
			}
		} : (e) => {
			let t, n = r.transitions || (r.transitions = Object.create(null)), i = 0;
			for (let r in e) (typeof e.hasOwnProperty != "function" || e.hasOwnProperty(r)) && (t = n[r], t || (t = n[r] = Object.create(null), i++), n = t);
			let a = n[$e];
			a ? a >= 96 && d ? (T[D++] = ((a -= 96) & 31) + 96, T[D++] = a >> 5) : T[D++] = a : C(n, n.__keys__ || Object.keys(e), i);
			for (let t in e) (typeof e.hasOwnProperty != "function" || e.hasOwnProperty(t)) && y(e[t]);
		}, b = typeof this.useRecords == "function" && this.useRecords, x = b ? (e) => {
			b(e) ? te(e) : ee(e);
		} : te, ne = (e) => {
			let i = o._writeStruct(e, T, t, D, r, S, (e, t, r) => {
				if (r) return n = !0;
				D = t;
				let i = T;
				return y(e), _(), i === T ? D : {
					position: D,
					targetView: E,
					target: T
				};
			});
			if (i === 0) return x(e);
			D = i;
		}, S = (e) => {
			let n;
			if (e > 16777216) {
				if (e - t > Je) throw Error("Packed buffer would be larger than maximum buffer size");
				n = Math.min(Je, Math.round(Math.max((e - t) * (e > 67108864 ? 1.25 : 2), 4194304) / 4096) * 4096);
			} else n = (Math.max(e - t << 2, T.length - 1) >> 12) + 1 << 12;
			let r = new Ke(n);
			return E = r.dataView ||= new DataView(r.buffer, 0, n), e = Math.min(e, T.length), T.copy ? T.copy(r, 0, t, e) : r.set(T.slice(t, e)), D -= t, t = 0, Xe = r.length - 10, T = r;
		}, C = (e, t, i) => {
			let a = r.nextId;
			a ||= 64, a < f && this.shouldShareStructure && !this.shouldShareStructure(t) ? (a = r.nextOwnId, a < p || (a = f), r.nextOwnId = a + 1) : (a >= p && (a = f), r.nextId = a + 1);
			let o = t.highByte = a >= 96 && d ? a - 96 >> 5 : -1;
			e[$e] = a, e.__keys__ = t, r[a - 64] = t, a < f ? (t.isShared = !0, r.sharedLength = a - 63, n = !0, o >= 0 ? (T[D++] = (a & 31) + 96, T[D++] = o) : T[D++] = a) : (o >= 0 ? (T[D++] = 213, T[D++] = 114, T[D++] = (a & 31) + 96, T[D++] = o) : (T[D++] = 212, T[D++] = 114, T[D++] = a), i && (h += g * i), m.length >= u && (m.shift()[$e] = 0), m.push(e), y(t));
		}, re = (e, n, r, i) => {
			let a = T, o = D, s = Xe, c = t;
			T = Ye, D = 0, t = 0, T || (Ye = T = new Ke(8192)), Xe = T.length - 10, C(e, n, i), Ye = T;
			let l = D;
			if (T = a, D = o, Xe = s, t = c, l > 1) {
				let e = D + l - 1;
				e > Xe && S(e);
				let n = r + t;
				T.copyWithin(n + l, n + 1, D), T.set(Ye.slice(0, l), n), D = e;
			} else T[r + t] = Ye[0];
		};
	}
	useBuffer(e) {
		T = e, T.dataView || (T.dataView = new DataView(T.buffer, T.byteOffset, T.byteLength)), E = T.dataView, D = 0;
	}
	set position(e) {
		D = e;
	}
	get position() {
		return D;
	}
	clearSharedData() {
		this.structures &&= [], this.typedStructs &&= [];
	}
};
We = [
	Date,
	Set,
	Error,
	RegExp,
	ArrayBuffer,
	Object.getPrototypeOf(Uint8Array.prototype).constructor,
	DataView,
	ie
], Ue = [
	{ pack(e, t, n) {
		let r = e.getTime() / 1e3;
		if ((this.useTimestamp32 || e.getMilliseconds() === 0) && r >= 0 && r < 4294967296) {
			let { target: e, targetView: n, position: i } = t(6);
			e[i++] = 214, e[i++] = 255, n.setUint32(i, r);
		} else if (r > 0 && r < 4294967296) {
			let { target: n, targetView: i, position: a } = t(10);
			n[a++] = 215, n[a++] = 255, i.setUint32(a, e.getMilliseconds() * 4e6 + (r / 1e3 / 4294967296 >> 0)), i.setUint32(a + 4, r);
		} else if (isNaN(r)) {
			if (this.onInvalidDate) return t(0), n(this.onInvalidDate());
			let { target: e, targetView: r, position: i } = t(3);
			e[i++] = 212, e[i++] = 255, e[i++] = 255;
		} else {
			let { target: n, targetView: i, position: a } = t(15);
			n[a++] = 199, n[a++] = 12, n[a++] = 255, i.setUint32(a, e.getMilliseconds() * 1e6), i.setBigInt64(a + 4, BigInt(Math.floor(r)));
		}
	} },
	{ pack(e, t, n) {
		if (this.setAsEmptyObject) return t(0), n({});
		let r = Array.from(e), { target: i, position: a } = t(this.moreTypes ? 3 : 0);
		this.moreTypes && (i[a++] = 212, i[a++] = 115, i[a++] = 0), n(r);
	} },
	{ pack(e, t, n) {
		let { target: r, position: i } = t(this.moreTypes ? 3 : 0);
		this.moreTypes && (r[i++] = 212, r[i++] = 101, r[i++] = 0), n([
			e.name,
			e.message,
			e.cause
		]);
	} },
	{ pack(e, t, n) {
		let { target: r, position: i } = t(this.moreTypes ? 3 : 0);
		this.moreTypes && (r[i++] = 212, r[i++] = 120, r[i++] = 0), n([e.source, e.flags]);
	} },
	{ pack(e, t) {
		this.moreTypes ? tt(e, 16, t) : nt(Ge ? Buffer.from(e) : new Uint8Array(e), t);
	} },
	{ pack(e, t) {
		let n = e.constructor;
		n !== qe && this.moreTypes ? tt(e, Pe.indexOf(n.name), t) : nt(e, t);
	} },
	{ pack(e, t) {
		this.moreTypes ? tt(e, 17, t) : nt(Ge ? Buffer.from(e) : new Uint8Array(e), t);
	} },
	{ pack(e, t) {
		let { target: n, position: r } = t(1);
		n[r] = 193;
	} }
];
function tt(e, t, n, r) {
	let i = e.byteLength;
	if (i + 1 < 256) {
		var { target: a, position: o } = n(4 + i);
		a[o++] = 199, a[o++] = i + 1;
	} else if (i + 1 < 65536) {
		var { target: a, position: o } = n(5 + i);
		a[o++] = 200, a[o++] = i + 1 >> 8, a[o++] = i + 1 & 255;
	} else {
		var { target: a, position: o, targetView: s } = n(7 + i);
		a[o++] = 201, s.setUint32(o, i + 1), o += 4;
	}
	a[o++] = 116, a[o++] = t, e.buffer || (e = new Uint8Array(e)), a.set(new Uint8Array(e.buffer, e.byteOffset, e.byteLength), o);
}
function nt(e, t) {
	let n = e.byteLength;
	var r, i;
	if (n < 256) {
		var { target: r, position: i } = t(n + 2);
		r[i++] = 196, r[i++] = n;
	} else if (n < 65536) {
		var { target: r, position: i } = t(n + 3);
		r[i++] = 197, r[i++] = n >> 8, r[i++] = n & 255;
	} else {
		var { target: r, position: i, targetView: a } = t(n + 5);
		r[i++] = 198, a.setUint32(i, n), i += 4;
	}
	r.set(e, i);
}
function rt(e, t, n, r) {
	let i = e.length;
	switch (i) {
		case 1:
			t[n++] = 212;
			break;
		case 2:
			t[n++] = 213;
			break;
		case 4:
			t[n++] = 214;
			break;
		case 8:
			t[n++] = 215;
			break;
		case 16:
			t[n++] = 216;
			break;
		default: i < 256 ? (t[n++] = 199, t[n++] = i) : i < 65536 ? (t[n++] = 200, t[n++] = i >> 8, t[n++] = i & 255) : (t[n++] = 201, t[n++] = i >> 24, t[n++] = i >> 16 & 255, t[n++] = i >> 8 & 255, t[n++] = i & 255);
	}
	return t[n++] = r, t.set(e, n), n += i, n;
}
function it(e, t) {
	let n, r = t.length * 6, i = e.length - r;
	for (; n = t.pop();) {
		let t = n.offset, a = n.id;
		e.copyWithin(t + r, t, i), r -= 6;
		let o = t + r;
		e[o++] = 214, e[o++] = 105, e[o++] = a >> 24, e[o++] = a >> 16 & 255, e[o++] = a >> 8 & 255, e[o++] = a & 255, i = t;
	}
	return e;
}
function at(e, t, n) {
	if (O.length > 0) {
		E.setUint32(O.position + e, D + n - O.position - e), O.stringsPosition = D - e;
		let r = O;
		O = null, t(r[0]), t(r[1]);
	}
}
function ot(e, t) {
	return e.isCompatible = (e) => {
		let n = !e || (t.lastNamedStructuresLength || 0) === e.length;
		return n || t._mergeStructures(e), n;
	}, e;
}
et.SUPPORTS_STRUCT_HOOKS = !0;
var st = new et({ useRecords: !1 });
st.pack, st.pack;
var { NEVER: ct, ALWAYS: lt, DECIMAL_ROUND: ut, DECIMAL_FIT: dt } = Ve, ft = new et({ useRecords: !0 }), pt = {
	encode: (e) => ft.pack(e),
	decode: (e) => ft.unpack(e)
}, mt = (e, t) => ({
	_zod: { def: e },
	evaluate: t
}), ht = -2147483648, gt = 2147483647, _t = () => mt({
	check: "number_format",
	format: "safeint"
}, (e) => Number.isInteger(e) || "expected an integer"), vt = (e) => mt({
	check: "greater_than",
	value: e,
	inclusive: !0
}, (t) => t >= e || `expected >= ${e}`), yt = (e) => mt({
	check: "less_than",
	value: e,
	inclusive: !0
}, (t) => t <= e || `expected <= ${e}`), bt = () => vt(0), xt = (e, t) => mt({ check: "custom" }, (n) => !!e(n) || (t ?? "failed custom check")), St = (e) => mt({
	check: "length_equals",
	length: e
}, (t) => t.length === e || `expected exactly ${e} items`), Ct = (e) => mt({
	check: "max_length",
	maximum: e
}, (t) => t.length <= e || `expected <=${e} items`), wt = (e) => mt({
	check: "min_length",
	minimum: e
}, (t) => t.length >= e || `expected >=${e} items`), Tt = (e, t, n) => mt({
	check: "number_format",
	format: e
}, (r) => Number.isInteger(r) && r >= t && r <= n || `expected a ${e}`), Et = (e, t, n) => mt({
	check: "bigint_format",
	format: e
}, (r) => r >= t && r <= n || `expected a ${e}`), Dt = /* @__PURE__ */ new WeakMap(), Ot = {
	add(e, t) {
		Dt.set(e, t);
	},
	get(e) {
		return Dt.get(e);
	}
}, kt = class extends Error {
	name = "SchemaError";
}, At = class {
	_zod;
	constructor(e) {
		this._zod = { def: e };
	}
	parse(e) {
		let t = this.inner(e);
		for (let e of this._zod.def.checks ?? []) {
			let n = e.evaluate(t);
			if (n !== !0) throw new kt(n);
		}
		return t;
	}
	safeParse(e) {
		try {
			return {
				success: !0,
				data: this.parse(e)
			};
		} catch (e) {
			return {
				success: !1,
				error: e
			};
		}
	}
	check(...e) {
		let t = Object.create(Object.getPrototypeOf(this));
		t._zod = { def: {
			...this._zod.def,
			checks: [...this._zod.def.checks ?? [], ...e]
		} };
		let n = Ot.get(this);
		return n && Ot.add(t, n), t;
	}
	register(e, t) {
		return e.add(this, t), this;
	}
}, jt = (e) => {
	throw new kt(`expected ${e}`);
}, Mt = class extends At {
	inner(e) {
		return typeof e == "number" && !Number.isNaN(e) ? e : jt("number");
	}
}, Nt = class extends At {
	inner(e) {
		return typeof e == "string" ? e : jt("string");
	}
}, Pt = class extends At {
	inner(e) {
		return typeof e == "boolean" ? e : jt("boolean");
	}
}, Ft = class extends At {
	inner(e) {
		return typeof e == "bigint" ? e : jt("bigint");
	}
}, It = class extends At {
	inner(e) {
		return e;
	}
}, Lt = class extends At {
	inner(e) {
		let t = this._zod.def.cls;
		return e instanceof t ? e : jt(t.name ?? "instance");
	}
}, Rt = class extends At {
	get shape() {
		return this._zod.def.shape;
	}
	inner(e) {
		(typeof e != "object" || !e || Array.isArray(e)) && jt("object");
		let t = {};
		for (let [n, r] of Object.entries(this.shape)) t[n] = r.parse(e[n]);
		return t;
	}
}, zt = class extends At {
	inner(e) {
		if (!Array.isArray(e)) return jt("array");
		let t = this._zod.def.element;
		return e.map((e) => t.parse(e));
	}
}, Bt = class extends At {
	inner(e) {
		return e === void 0 ? void 0 : this._zod.def.element.parse(e);
	}
}, Vt = class extends At {
	inner(e) {
		return e === null ? null : this._zod.def.element.parse(e);
	}
}, Ht = class extends At {
	inner(e) {
		return e === this._zod.def.literal ? e : jt(JSON.stringify(this._zod.def.literal));
	}
}, Ut = class extends At {
	inner(e) {
		for (let t of this._zod.def.options) {
			let n = t.safeParse(e);
			if (n.success) return n.data;
		}
		return jt("a union member");
	}
}, Wt = class extends At {
	inner(e) {
		(typeof e != "object" || !e || Array.isArray(e)) && jt("object");
		let t = this._zod.def.element, n = {};
		for (let [r, i] of Object.entries(e)) n[r] = t.parse(i);
		return n;
	}
}, Gt = class extends At {
	inner(e) {
		return typeof e == "function" ? e : jt("function");
	}
}, Kt = () => k(new Mt({ type: "number" })), qt = () => k(new Nt({ type: "string" })), Jt = () => k(new Pt({ type: "boolean" })), Yt = () => k(new Ft({ type: "bigint" })), Xt = () => k(new It({ type: "unknown" })), Zt = (e) => k(new Lt({
	type: "instanceof",
	cls: e
})), Qt = (e) => k(new Rt({
	type: "object",
	shape: e
})), $t = (e) => k(new zt({
	type: "array",
	element: e
})), en = (e) => k(new Bt({
	type: "optional",
	element: e
})), tn = (e) => k(new Vt({
	type: "nullable",
	element: e
})), nn = (e) => k(new Ht({
	type: "literal",
	literal: e
})), rn = (e) => k(new Ut({
	type: "union",
	options: e
})), an = (e) => k(new Wt({
	type: "record",
	element: e
})), on = () => k(new Gt({ type: "function" })), sn = () => new Mt({
	type: "number",
	format: "int32"
}).check(Tt("int32", ht, gt)), cn = () => new Mt({
	type: "number",
	format: "uint32"
}).check(Tt("uint32", 0, 4294967295)), ln = () => new Mt({
	type: "number",
	format: "float32"
}), un = () => new Mt({
	type: "number",
	format: "float64"
}), dn = () => new Ft({
	type: "bigint",
	format: "int64"
}).check(Et("int64", -(2n ** 63n), 2n ** 63n - 1n)), fn = () => new Ft({
	type: "bigint",
	format: "uint64"
}).check(Et("uint64", 0n, 2n ** 64n - 1n)), pn = /* @__PURE__ */ new Set([
	"string",
	"array",
	"set"
]), mn = (e, t, n) => {
	let r = pn.has(e._zod.def.type);
	return t === "min" ? r ? wt(n) : vt(n) : r ? Ct(n) : yt(n);
};
function k(e) {
	let t = e.check.bind(e), n = e.register.bind(e), r = {
		refine: (e, n) => k(t(xt(e, n))),
		meta: (t) => t === void 0 ? Ot.get(e) : k(n(Ot, t)),
		min: (n) => k(t(mn(e, "min", n))),
		max: (n) => k(t(mn(e, "max", n))),
		length: (e) => k(t(St(e))),
		int: () => k(t(_t())),
		optional: () => k(new Bt({
			type: "optional",
			element: e
		})),
		nullable: () => k(new Vt({
			type: "nullable",
			element: e
		}))
	};
	for (let [t, n] of Object.entries(r)) Object.defineProperty(e, t, {
		value: n,
		enumerable: !1,
		configurable: !0
	});
	return e;
}
var A = {
	number: Kt,
	string: qt,
	boolean: Jt,
	bigint: Yt,
	object: Qt,
	array: $t,
	instanceof: Zt,
	unknown: Xt,
	optional: en,
	nullable: tn,
	literal: nn,
	union: rn,
	record: an,
	callback: on,
	int32: sn,
	uint32: cn,
	float32: ln,
	float64: un,
	int64: dn,
	uint64: fn,
	int: _t,
	gte: vt,
	lte: yt,
	nonnegative: bt,
	refine: xt,
	length: St,
	maxLength: Ct,
	minLength: wt,
	globalRegistry: Ot,
	ZodType: At,
	ZodObject: Rt,
	ZodArray: zt,
	ZodString: Nt
};
new TextEncoder();
var hn = (e, t) => k(A.number().check(A.int(), A.gte(e), A.lte(t)));
hn(-128, 127), hn(0, 255), hn(-32768, 32767), hn(0, 65535), k(A.int32()), k(A.uint32()), k(A.number()), k(A.number()), k(A.bigint()), k(A.bigint().check(A.nonnegative()));
function gn(e) {
	return typeof e == "object" && !!e && typeof e._zod?.def == "object";
}
var _n = {
	int32: "i32",
	uint32: "u32",
	float32: "f32",
	float64: "f64"
}, vn = {
	int64: "i64",
	uint64: "u64"
}, yn = [
	{
		kind: "u8",
		min: 0,
		max: 255
	},
	{
		kind: "i8",
		min: -128,
		max: 127
	},
	{
		kind: "u16",
		min: 0,
		max: 65535
	},
	{
		kind: "i16",
		min: -32768,
		max: 32767
	},
	{
		kind: "u32",
		min: 0,
		max: 4294967295
	},
	{
		kind: "i32",
		min: -2147483648,
		max: 2147483647
	}
], bn = (e) => e.def ?? e._zod?.def;
function xn(e) {
	let t = [e.format, ...(e.checks ?? []).map((e) => bn(e)?.format)], n = t.find((e) => !!e && e in _n);
	if (n) return _n[n];
	if (t.includes("safeint")) {
		let t = -Infinity, n = Infinity;
		for (let r of e.checks ?? []) {
			let e = bn(r);
			e?.check === "greater_than" && e.inclusive && (t = e.value ?? t), e?.check === "less_than" && e.inclusive && (n = e.value ?? n);
		}
		for (let e of yn) if (t >= e.min && n <= e.max) return e.kind;
	}
	return "f64";
}
function Sn(e, t) {
	if (typeof e == "string") return e;
	if (!gn(e)) {
		if (typeof e.string == "number" || e.bool === !0) return e;
		throw TypeError(`member "${t}": expected a scalar token, { string: n }, { bool: true }, or a zod schema`);
	}
	let n = e._zod.def;
	if (n.type === "number") return xn(n);
	if (n.type === "bigint") return vn[n.format ?? ""] ?? "i64";
	if (n.type === "boolean") return { bool: !0 };
	if (n.type === "string") {
		let n = Tn(e);
		if (typeof n == "number") return { string: n };
		throw TypeError(`member "${t}": z.string() needs .meta({ bytes: n }) — inline strings are fixed-width`);
	}
	throw TypeError(`member "${t}": zod "${n.type}" can't lay out as a fixed-width scalar — use number, bigint, boolean, or a bounded string`);
}
function Cn(e) {
	return !gn(e) || e._zod.def.type !== "object" ? null : e._zod.def.shape;
}
function wn(e) {
	if (!gn(e) || e._zod.def.type !== "array") return null;
	let t = e._zod.def, n = null;
	for (let e of t.checks ?? []) {
		let t = bn(e);
		t?.check === "max_length" && typeof t.maximum == "number" && (n = t.maximum), t?.check === "length_equals" && typeof t.length == "number" && (n = t.length);
	}
	return {
		element: t.element,
		capacity: n
	};
}
function Tn(e) {
	let t = A.globalRegistry.get(e) ?? e.meta?.();
	return typeof t?.bytes == "number" ? t.bytes : null;
}
function En(e) {
	return !gn(e) || e._zod.def.type !== "string" ? null : Tn(e);
}
//#endregion
//#region ../../src/devtools.ts
var Dn = typeof WorkerGlobalScope < "u" && self instanceof WorkerGlobalScope ? "worker" : "main", On = null, kn = null, An = /* @__PURE__ */ new Set(), jn = () => {
	if (An.size === 0) {
		On = kn;
		return;
	}
	let e = kn ? [kn, ...An] : [...An];
	On = e.length === 1 ? e[0] : (t) => {
		for (let n of e) try {
			n(t);
		} catch {}
	};
}, Mn = (e) => {
	kn = e, jn();
}, Nn = (e) => {
	On && On({
		...e,
		at: performance.now(),
		thread: Dn
	});
}, Pn = () => On !== null, Fn = (e, t = 2048) => {
	let n = /* @__PURE__ */ new WeakSet(), r;
	try {
		r = JSON.stringify(e, (e, t) => {
			if (typeof t == "function") return "[fn]";
			if (typeof t == "bigint") return `${t}n`;
			if (t instanceof ArrayBuffer) return `[ArrayBuffer ${t.byteLength}B]`;
			if (ArrayBuffer.isView(t)) return `[${t.constructor.name} ${t.byteLength}B]`;
			if (t instanceof Map) return { "[Map]": [...t.entries()].slice(0, 50) };
			if (t instanceof Set) return { "[Set]": [...t].slice(0, 50) };
			if (t && typeof t == "object") {
				if (n.has(t)) return "[cycle]";
				n.add(t);
			}
			return t;
		}) ?? String(e);
	} catch {
		r = String(e);
	}
	return r.length > t ? `${r.slice(0, t)}…` : r;
}, In = /* @__PURE__ */ new Map(), Ln = (e, t) => (In.set(e, t), () => {
	In.get(e) === t && In.delete(e);
}), Rn = !1, zn = () => {
	Rn || typeof self > "u" || (Rn = !0, Mn((e) => {
		self.postMessage({
			type: "ATOLL_DEVTOOLS",
			event: e
		});
	}), qn(self), Yn(self));
}, Bn = Symbol.for("atoll.devtools.fetch"), Vn = 8192, Hn = /text|json|javascript|xml|html|css|svg|csv|urlencoded|graphql/, Un = (e) => e ? [...e.entries()].slice(0, 64) : void 0, Wn = (e) => {
	if (e != null) return typeof e == "string" ? e.slice(0, Vn) : e instanceof URLSearchParams ? String(e).slice(0, Vn) : e instanceof Blob ? `[${e.type || "blob"} ${e.size}B]` : e instanceof ArrayBuffer ? `[ArrayBuffer ${e.byteLength}B]` : ArrayBuffer.isView(e) ? `[${e.constructor.name} ${e.byteLength}B]` : typeof FormData < "u" && e instanceof FormData ? "[FormData]" : "[stream]";
}, Gn = async (e, t) => {
	let n = e.body?.getReader();
	if (!n) return;
	let r = [], i = 0;
	try {
		for (; i < t;) {
			let { done: e, value: t } = await n.read();
			if (e || !t) break;
			r.push(t), i += t.byteLength;
		}
	} catch {}
	if (!i) return;
	let a = new Uint8Array(i), o = 0;
	for (let e of r) a.set(e, o), o += e.byteLength;
	return new TextDecoder().decode(a) + (i >= t ? "…" : "");
}, Kn = async (e, t) => {
	let n = globalThis.performance;
	if (n?.getEntriesByType) for (let r = 0; r < 12; r++) {
		let r;
		for (let i of n.getEntriesByType("resource")) i.name !== e || i.startTime < t - 5 || (!r || i.startTime < r.startTime) && (r = i);
		if (r) {
			let e = (e, t) => t > e && e > 0 ? t - e : 0;
			return {
				queue: e(r.fetchStart, r.domainLookupStart),
				dns: e(r.domainLookupStart, r.domainLookupEnd),
				tcp: r.secureConnectionStart > 0 ? e(r.connectStart, r.secureConnectionStart) : e(r.connectStart, r.connectEnd),
				tls: r.secureConnectionStart > 0 ? e(r.secureConnectionStart, r.connectEnd) : 0,
				wait: e(r.requestStart, r.responseStart),
				download: e(r.responseStart, r.responseEnd),
				transferSize: r.transferSize,
				encodedSize: r.encodedBodySize,
				decodedSize: r.decodedBodySize
			};
		}
		await new Promise((e) => setTimeout(e, 250));
	}
}, qn = (e) => {
	let t = e.fetch;
	if (!t || t[Bn]) return;
	let n = 0, r = async (r, i) => {
		let a = performance.now(), o = ++n, s = typeof Request < "u" && r instanceof Request, c = s ? r.url : String(r), l = (() => {
			try {
				return new URL(c, self.location?.href).href;
			} catch {
				return c;
			}
		})(), u = (i?.method ?? (s ? r.method : "GET")).toUpperCase(), d = s && !i?.body ? r.clone() : null, f = Un(i?.headers ? new Headers(i.headers) : s ? r.headers : void 0), p = Wn(i?.body);
		try {
			let n = await t.call(e, r, i), s = n.headers.get("content-length");
			Nn({
				type: "net:fetch",
				id: o,
				url: c.slice(0, 300),
				method: u,
				status: n.status,
				ms: performance.now() - a,
				bytes: s === null ? void 0 : Number(s),
				reqHeaders: f,
				reqBody: p
			});
			let m = n.clone();
			return (async () => {
				p ??= d ? await d.text().then((e) => e.slice(0, Vn)).catch(() => void 0) : void 0;
				let e = n.headers.get("content-type") ?? "", t = Hn.test(e) ? await Gn(m, Vn).catch(() => void 0) : void 0, r = await Kn(l, a);
				Nn({
					type: "net:fetch-detail",
					id: o,
					reqBody: p,
					resHeaders: Un(n.headers),
					resBody: t,
					timing: r,
					transferSize: r?.transferSize,
					encodedSize: r?.encodedSize,
					decodedSize: r?.decodedSize
				});
			})(), n;
		} catch (e) {
			throw Nn({
				type: "net:fetch",
				id: o,
				url: c.slice(0, 300),
				method: u,
				ms: performance.now() - a,
				error: e instanceof Error ? e.message : String(e),
				reqHeaders: f,
				reqBody: p
			}), e;
		}
	};
	r[Bn] = !0, e.fetch = r;
}, Jn = /* @__PURE__ */ new WeakSet(), Yn = (e, t = 2500) => {
	if (Jn.has(e)) return;
	let n = e.performance;
	if (!n) return;
	let r = n.memory, i = typeof WorkerGlobalScope < "u" && globalThis.self instanceof WorkerGlobalScope, a = n.measureUserAgentSpecificMemory?.bind(n), o = globalThis.process?.memoryUsage;
	if (r || a && !i || o) {
		if (Jn.add(e), a && !i) {
			setInterval(() => {
				a().then((e) => {
					let t = (e.breakdown ?? []).map((e) => ({
						bytes: e.bytes,
						scope: e.attribution?.[0]?.scope,
						url: e.attribution?.[0]?.url
					})).sort((e, t) => t.bytes - e.bytes).slice(0, 24);
					Nn({
						type: "runtime:memory",
						heapBytes: e.bytes,
						heapLimitBytes: r?.jsHeapSizeLimit,
						contexts: t
					});
				}).catch(() => {
					r && Nn({
						type: "runtime:memory",
						heapBytes: r.usedJSHeapSize,
						heapLimitBytes: r.jsHeapSizeLimit
					});
				});
			}, Math.max(t, 4e3)).unref?.();
			return;
		}
		setInterval(() => {
			if (r) Nn({
				type: "runtime:memory",
				heapBytes: r.usedJSHeapSize,
				heapLimitBytes: r.jsHeapSizeLimit
			});
			else if (o) {
				let e = o();
				Nn({
					type: "runtime:memory",
					heapBytes: e.heapUsed,
					rssBytes: e.rss
				});
			}
		}, t).unref?.();
	}
}, Xn = /* @__PURE__ */ new Map(), Zn = () => [], Qn = !1, $n = 5, er = 16, tr = (e) => {
	let t = e;
	if (typeof t.readAt == "function" && typeof t.recordCount == "number") {
		let e = Array.from({ length: Math.min($n, t.recordCount) }, (e, n) => t.readAt(n));
		return Fn({
			records: t.recordCount,
			head: e
		}, 1024);
	}
	let n = e.read();
	if (ArrayBuffer.isView(n) && !(n instanceof DataView)) {
		let e = n, t = Array.from({ length: Math.min(er, e.length) }, (t, n) => typeof e[n] == "bigint" ? `${e[n]}n` : e[n]);
		return `${n.constructor.name}(${e.length}) ${JSON.stringify(t)}${e.length > er ? "…" : ""}`;
	}
	return Fn(n, 1024);
}, nr = (e, t) => e.connector(t), rr = (e) => e._version ? Atomics.load(e._version.view, e._version.index) : 0, ir = (e) => {
	try {
		return JSON.parse(e);
	} catch {
		return e;
	}
}, ar = (e) => typeof e == "number" ? e : typeof e == "bigint" ? Number(e) : null, or = (e) => {
	let t = e.trim();
	if (t === "change") return {
		text: t,
		test: () => !0
	};
	let n = /^(>=|<=|==|!=|>|<)\s*(.+)$/.exec(t);
	if (!n) throw Error(`memory.watch: bad rule '${e}' — use change, > n, < n, >= n, <= n, == v, != v`);
	let [, r, i] = n;
	if (r === "==" || r === "!=") {
		let e = ir(i), n = (t) => typeof t == "object" && t ? Fn(t) === Fn(e) : Object.is(t, e) || typeof t == "bigint" && Number(t) === e;
		return {
			text: t,
			test: r === "==" ? n : (e) => !n(e)
		};
	}
	let a = Number(i);
	if (!Number.isFinite(a)) throw Error(`memory.watch: '${i}' is not a number`);
	let o = {
		">": (e) => e > a,
		"<": (e) => e < a,
		">=": (e) => e >= a,
		"<=": (e) => e <= a
	};
	return {
		text: t,
		test: (e) => {
			let t = ar(e);
			return t !== null && o[r](t);
		}
	};
}, sr = (e, t, n, r, i) => {
	let a = n.seen.get(e);
	if (a && a.version >= i) return;
	let o = n.rule.text === "change", s = typeof r.readAt == "function", c, l;
	try {
		l = tr(r), c = o || s ? void 0 : r.read();
	} catch {
		return;
	}
	n.seen.set(e, {
		version: i,
		preview: l
	}), (o ? l !== a?.preview : !s && n.rule.test(c)) && (n.hits++, Nn({
		type: "memory:watch-hit",
		path: t,
		version: i,
		value: l,
		rule: n.rule.text
	}));
}, cr = (e, t, n) => {
	let r = Xn.get(t);
	r && sr(e, t, r, nr(e, t), n);
}, lr = (e, t) => {
	let n = !1, r = () => {
		for (let n of Zn()) {
			if (!n.bound) continue;
			let r;
			try {
				r = nr(n, e);
			} catch {
				continue;
			}
			sr(n, e, t, r, rr(r));
		}
	};
	if (typeof Atomics.waitAsync == "function") return (async () => {
		for (; !n;) {
			let t = Zn().find((t) => {
				try {
					return t.bound && nr(t, e)._version !== void 0;
				} catch {
					return !1;
				}
			}), i = t ? nr(t, e)._version : void 0;
			if (i) {
				let e = Atomics.waitAsync(i.view, i.index, Atomics.load(i.view, i.index), 250);
				e.async && await e.value;
			} else await new Promise((e) => setTimeout(e, 250));
			n || r();
		}
	})(), () => {
		n = !0;
	};
	let i = setInterval(r, 50);
	return i.unref?.(), () => {
		n = !0, clearInterval(i);
	};
}, ur = () => [...Xn.entries()].map(([e, t]) => ({
	path: e,
	rule: t.rule.text,
	hits: t.hits
})), dr = (e) => {
	Zn = e, !Qn && (Qn = !0, Ln("memory.read", () => {
		let e = [];
		return Zn().forEach((t, n) => {
			if (t.bound) for (let { path: r } of t.fields()) try {
				let i = nr(t, r);
				e.push({
					path: r,
					value: tr(i),
					version: rr(i),
					contract: n
				});
			} catch (t) {
				e.push({
					path: r,
					value: `[unreadable: ${t.message}]`,
					version: -1,
					contract: n
				});
			}
		}), e;
	}), Ln("memory.watch", (e) => {
		let t = String(e.path ?? "");
		if (!t) throw Error("memory.watch: `path` is required");
		if (!Zn().some((e) => e.fields().some((e) => e.path === t))) throw Error(`memory.watch: no contract defines a field '${t}'`);
		let n = or(String(e.rule ?? "change"));
		Xn.get(t)?.stop();
		let r = {
			rule: n,
			seen: /* @__PURE__ */ new WeakMap(),
			stop: () => {},
			hits: 0
		};
		for (let e of Zn()) if (e.bound) try {
			let n = nr(e, t);
			r.seen.set(e, {
				version: rr(n),
				preview: tr(n)
			});
		} catch {}
		return Xn.set(t, r), r.stop = lr(t, r), ur();
	}), Ln("memory.unwatch", (e) => {
		let t = String(e.path ?? "");
		return Xn.get(t)?.stop(), Xn.delete(t), ur();
	}), Ln("memory.watches", () => ur()));
}, fr = {
	trace: 0,
	debug: 1,
	info: 2,
	warn: 3,
	error: 4,
	off: 5
}, pr = typeof WorkerGlobalScope < "u" && self instanceof WorkerGlobalScope ? "worker" : "main", mr = ({ level: e, scope: t, message: n, data: r, thread: i, at: a }) => {
	let o = `[${(a / 1e3).toFixed(2)}s ${i}:${t}]`, s = e === "error" ? console.error : e === "warn" ? console.warn : e === "info" ? console.info : console.debug;
	r === void 0 ? s(`${o} ${n}`) : s(`${o} ${n}`, r);
}, hr = "info", gr = mr, _r = !1;
function vr(e, t, n, r) {
	if (!(fr[e] < fr[hr]) && (gr({
		level: e,
		scope: t,
		message: n,
		data: r,
		thread: pr,
		at: performance.now()
	}), !_r && Pn())) {
		_r = !0;
		try {
			Nn({
				type: "log",
				level: e,
				scope: t,
				message: n,
				...r === void 0 ? {} : { data: Fn(r, 1024) }
			});
		} finally {
			_r = !1;
		}
	}
}
function yr(e) {
	return {
		trace: (t, n) => vr("trace", e, t, n),
		debug: (t, n) => vr("debug", e, t, n),
		info: (t, n) => vr("info", e, t, n),
		warn: (t, n) => vr("warn", e, t, n),
		error: (t, n) => vr("error", e, t, n)
	};
}
var br = (e) => e >= 1 << 20 ? `${(e / (1 << 20)).toFixed(1)}MB` : e >= 1024 ? `${(e / 1024).toFixed(1)}KB` : `${e}B`, xr = yr("memory"), Sr = 8, Cr = (e, t) => e + t - 1 & ~(t - 1), wr = (e) => Cr(e, Sr), Tr = (e) => typeof e == "object" && !!e && typeof e.kind == "string" && typeof e.byteLength == "number";
function Er(e) {
	let t = [];
	for (let [n, r] of Object.entries(e)) if (Tr(r)) t.push({
		path: n,
		descriptor: r
	});
	else for (let [e, i] of Object.entries(r)) {
		if (!Tr(i)) throw TypeError(`shared memory "${n}.${e}" is not a field descriptor — intent groups nest one level only`);
		t.push({
			path: `${n}.${e}`,
			descriptor: i
		});
	}
	return t;
}
new TextEncoder(), new TextDecoder();
var Dr = /* @__PURE__ */ new Map();
function Or(e, t) {
	Dr.set(e, t);
}
var kr = {
	i8: 1,
	u8: 1,
	i16: 2,
	u16: 2,
	i32: 4,
	u32: 4,
	f32: 4,
	f64: 8,
	i64: 8,
	u64: 8
}, Ar = (e) => typeof e == "string" ? kr[e] : "string" in e ? e.string : 1, jr = (e) => typeof e == "string" ? kr[e] : 1;
function Mr(e) {
	let t = {}, n = {}, r = 0;
	for (let i of Object.keys(e)) {
		let a = Sn(e[i], String(i));
		n[i] = a, r = Cr(r, jr(a)), t[i] = r, r += Ar(a);
	}
	return {
		layout: n,
		offsets: t,
		recordSize: wr(r)
	};
}
var Nr = {
	number: () => ({
		kind: "number",
		byteLength: 8
	}),
	boolean: () => ({
		kind: "boolean",
		byteLength: 8
	}),
	string: (e) => {
		let { schema: t, maxBytes: n } = e;
		if (n !== void 0) return {
			kind: "string",
			byteLength: 4 + n,
			schema: t
		};
		let r = t ? En(t) : null;
		if (r !== null) return {
			kind: "string",
			byteLength: 4 + r,
			schema: t
		};
		throw TypeError("field.string: pass { maxBytes } or a schema carrying a byte budget — reef.string(n) / z.string().meta({ bytes: n })");
	},
	object: (e) => {
		let { schema: t, maxBytes: n } = e;
		if (n === void 0 && t) {
			let e = Cn(t);
			if (e) {
				let { layout: n, offsets: r, recordSize: i } = Mr(e);
				return {
					kind: "object",
					byteLength: 8 + i,
					schema: t,
					layout: n,
					offsets: r,
					recordSize: i
				};
			}
			throw TypeError("field.object: schema can't derive a fixed byte width (not a zod object of fixed-width members) — pass { maxBytes } for codec-encoded storage");
		}
		if (n === void 0) throw TypeError("field.object: pass { schema } for a fixed-layout field or { maxBytes } for a codec-encoded field");
		return {
			kind: "object",
			byteLength: 4 + n,
			schema: t
		};
	},
	array: (e) => {
		let { schema: t, maxBytes: n } = e;
		if (n === void 0 && t) {
			let e = wn(t);
			if (e) {
				if (e.capacity === null) throw TypeError("field.array: z.array() needs .max(n) or .length(n) — bounded arrays are fixed-width");
				let n;
				try {
					n = Sn(e.element, "array element");
				} catch (e) {
					throw TypeError(`field.array: element isn't a fixed-width member — use field.list for arrays of records (${e.message})`);
				}
				let r = Cr(Ar(n), jr(n));
				return {
					kind: "array",
					byteLength: 8 + e.capacity * r,
					schema: t,
					element: n,
					elementStride: r,
					capacity: e.capacity
				};
			}
			throw TypeError("field.array: schema can't derive a fixed byte width (not a bounded zod array) — pass { maxBytes } for codec-encoded storage");
		}
		if (n === void 0) throw TypeError("field.array: pass { schema } for a fixed-layout field or { maxBytes } for a codec-encoded field");
		return {
			kind: "array",
			byteLength: 4 + n,
			schema: t
		};
	},
	int32Array: ({ length: e }) => ({
		kind: "Int32",
		byteLength: e * 4
	}),
	float64Array: ({ length: e }) => ({
		kind: "Float64",
		byteLength: e * 8
	}),
	bigInt64Array: ({ length: e }) => ({
		kind: "BigInt64",
		byteLength: e * 8
	}),
	uint8Array: ({ length: e }) => ({
		kind: "Uint8",
		byteLength: e
	}),
	list: ({ schema: e, count: t }) => {
		let n = Cn(e);
		if (!n) throw TypeError("field.list: schema must be a reef.object() of fixed-width members");
		let { layout: r, offsets: i, recordSize: a } = Mr(n);
		return {
			kind: "list",
			byteLength: a * t,
			schema: e,
			layout: r,
			offsets: i,
			recordSize: a,
			count: t
		};
	}
}, Pr = {
	Int32: Int32Array,
	Float64: Float64Array,
	BigInt64: BigInt64Array,
	Uint8: Uint8Array
};
Or("number", (e, t, n) => {
	let r = new Float64Array(t.buffer, n, 1);
	return {
		byteOffset: n,
		byteLength: e.byteLength,
		read: () => r[0],
		write: (e) => {
			r[0] = e;
		}
	};
}), Or("boolean", (e, t, n) => {
	let r = new Uint8Array(t.buffer, n, 1);
	return {
		byteOffset: n,
		byteLength: e.byteLength,
		read: () => r[0] === 1,
		write: (e) => {
			r[0] = +!!e;
		}
	};
});
for (let e of Object.keys(Pr)) Or(e, (t, n, r) => {
	let i = Pr[e], a = new i(n.buffer, r, t.byteLength / i.BYTES_PER_ELEMENT);
	return {
		byteOffset: r,
		byteLength: t.byteLength,
		read: () => a,
		write: (e) => a.set(e)
	};
});
Or("string", (e, t, n) => {
	let r = new TextEncoder(), i = new TextDecoder(), a = e.byteLength - 4, o = new Uint32Array(t.buffer, n, 1), s = (e) => {
		if (e.byteLength > a) throw Error(`Encoded value of ${e.byteLength} bytes exceeds field capacity of ${a} bytes at offset ${n}`);
		o[0] = e.byteLength, new Uint8Array(t.buffer, n + 4, e.byteLength).set(e);
	}, c = () => new Uint8Array(t.buffer, n + 4, o[0]).slice();
	return {
		byteOffset: n,
		byteLength: e.byteLength,
		read: () => i.decode(c()),
		write: (t) => s(r.encode(e.schema ? e.schema.parse(t) : t))
	};
});
function Fr(e) {
	let t = new DataView(e.buffer), n = new Uint8Array(e.buffer), r = new TextEncoder(), i = new TextDecoder(), a = {
		i8: {
			get: (e) => t.getInt8(e),
			set: (e, n) => t.setInt8(e, n)
		},
		u8: {
			get: (e) => t.getUint8(e),
			set: (e, n) => t.setUint8(e, n)
		},
		i16: {
			get: (e) => t.getInt16(e),
			set: (e, n) => t.setInt16(e, n)
		},
		u16: {
			get: (e) => t.getUint16(e),
			set: (e, n) => t.setUint16(e, n)
		},
		i32: {
			get: (e) => t.getInt32(e),
			set: (e, n) => t.setInt32(e, n)
		},
		u32: {
			get: (e) => t.getUint32(e),
			set: (e, n) => t.setUint32(e, n)
		},
		f32: {
			get: (e) => t.getFloat32(e),
			set: (e, n) => t.setFloat32(e, n)
		},
		f64: {
			get: (e) => t.getFloat64(e),
			set: (e, n) => t.setFloat64(e, n)
		},
		i64: {
			get: (e) => t.getBigInt64(e),
			set: (e, n) => t.setBigInt64(e, n)
		},
		u64: {
			get: (e) => t.getBigUint64(e),
			set: (e, n) => t.setBigUint64(e, n)
		}
	}, o = (e, t) => {
		let r = n.indexOf(0, e), a = r === -1 || r - e >= t ? t : r - e;
		return i.decode(n.slice(e, e + a));
	}, s = /* @__PURE__ */ new Uint8Array(64), c = (e, t, i) => {
		s.length < t && (s = new Uint8Array(t));
		let { read: a, written: o } = r.encodeInto(i, s);
		if (a < i.length || o > t) throw Error(`String exceeds inline field capacity of ${t} bytes`);
		n.set(s.subarray(0, o), e), o < t && n.fill(0, e + o, e + t);
	}, l = (e) => {
		if (typeof e == "string") {
			let t = a[e];
			return {
				get: (e) => t.get(e),
				set: (e, n) => t.set(e, n)
			};
		}
		return "bool" in e ? {
			get: (e) => !!t.getUint8(e),
			set: (e, n) => t.setUint8(e, +!!n)
		} : {
			get: (t) => o(t, e.string),
			set: (t, n) => c(t, e.string, n)
		};
	};
	return {
		ops: l,
		compile: (e, t) => {
			let n = /* @__PURE__ */ new Map(), r = /* @__PURE__ */ new Map();
			for (let i of Object.keys(e)) {
				let { get: a, set: o } = l(e[i]), s = t[i];
				n.set(i, (e, t) => {
					t[i] = a(e + s);
				}), r.set(i, (e, t) => o(e + s, t[i]));
			}
			let i = [...n.values()], a = [...r.values()];
			return {
				read(e, t = {}, r) {
					if (r) for (let i of r) n.get(i)(e, t);
					else for (let n of i) n(e, t);
					return t;
				},
				write(e, t, n) {
					if (n) for (let i of n) r.get(i)(e, t);
					else for (let n of a) n(e, t);
				}
			};
		}
	};
}
var Ir = (e, t, n) => {
	let { schema: r, byteLength: i, kind: a } = e, o = e;
	if (o.layout && o.offsets && o.recordSize !== void 0) {
		let e = new Uint32Array(t.buffer, n, 2), a = n + 8, s = Fr(t).compile(o.layout, o.offsets);
		return {
			byteOffset: n,
			byteLength: i,
			read: () => e[0] ? s.read(a, {}) : void 0,
			write: (t) => {
				s.write(a, r ? r.parse(t) : t), e[0] = 1;
			}
		};
	}
	if (o.element !== void 0 && o.elementStride !== void 0 && o.capacity !== void 0) {
		let e = new Uint32Array(t.buffer, n, 1), a = new Uint32Array(t.buffer, n + 4, 1), s = Fr(t).ops(o.element), c = o.elementStride, l = o.capacity, u = n + 8;
		return {
			byteOffset: n,
			byteLength: i,
			read: () => {
				if (!e[0]) return;
				let t = a[0];
				return Array.from({ length: t }, (e, t) => s.get(u + t * c));
			},
			write: (t) => {
				let n = r ? r.parse(t) : t;
				if (n.length > l) throw Error(`${n.length} elements exceeds array capacity of ${l}`);
				n.forEach((e, t) => s.set(u + t * c, e)), a[0] = n.length, e[0] = 1;
			}
		};
	}
	let s = i - 4, c = new Uint32Array(t.buffer, n, 1), l = (e) => {
		if (e.byteLength > s) throw Error(`Encoded value of ${e.byteLength} bytes exceeds field capacity of ${s} bytes at offset ${n}`);
		c[0] = e.byteLength, new Uint8Array(t.buffer, n + 4, e.byteLength).set(e);
	}, u = () => new Uint8Array(t.buffer, n + 4, c[0]).slice();
	return {
		byteOffset: n,
		byteLength: i,
		read: () => {
			let e = u();
			if (e.byteLength === 0) return;
			let n = t.codec.decode(e);
			return r ? r.parse(n) : n;
		},
		write: (e) => l(t.codec.encode(r ? r.parse(e) : e))
	};
};
Or("object", Ir), Or("array", Ir);
function Lr(e, t, n) {
	let r = e, { offsets: i, recordSize: a, count: o } = r, s = Fr(t).compile(r.layout, i), c = (e) => {
		if (e < 0 || e >= o) throw RangeError(`Record index ${e} out of bounds (0..${o - 1})`);
	}, l = (e, t = {}, r) => (c(e), s.read(n + e * a, t, r)), u = (e, t, r) => {
		c(e), s.write(n + e * a, t, r);
	};
	return {
		byteOffset: n,
		byteLength: e.byteLength,
		recordCount: o,
		recordSize: a,
		readAt: l,
		writeAt: u,
		commit: () => {
			if (t.version) {
				let e = Atomics.add(t.version.view, t.version.index, 1);
				Atomics.notify(t.version.view, t.version.index), t.path && Pn() && Nn({
					type: "memory:write",
					path: t.path,
					version: e + 1
				});
			}
		},
		read: () => Array.from({ length: o }, (e, t) => l(t)),
		write: (e) => {
			if (e.length > o) throw Error(`${e.length} records exceeds list array capacity of ${o}`);
			e.forEach((e, t) => u(t, e));
		}
	};
}
Or("list", Lr);
var Rr = [];
function zr(e) {
	let t = {};
	for (let [n, r] of Object.entries(e)) t[n] = Tr(r) ? Br(r) : Object.fromEntries(Object.entries(r).map(([e, t]) => [e, Br(t)]));
	return t;
}
function Br(e) {
	if (e.schema) return e.schema;
	switch (e.kind) {
		case "number": return k(A.number());
		case "boolean": return k(A.boolean());
		case "string": return k(A.string());
		case "Int32": return k(A.instanceof(Int32Array));
		case "Float64": return k(A.instanceof(Float64Array));
		case "BigInt64": return k(A.instanceof(BigInt64Array));
		case "Uint8": return k(A.instanceof(Uint8Array));
		default: return k(A.unknown());
	}
}
var Vr = class {
	totalBytes;
	spec;
	schemas;
	codec;
	plugins;
	entries;
	offsets = /* @__PURE__ */ new Map();
	versionOffset;
	connectors = /* @__PURE__ */ new Map();
	boundListeners = /* @__PURE__ */ new Set();
	isBound = !1;
	boundBuffer;
	constructor(e, t = {}) {
		this.spec = e, this.codec = t.codec ?? pt, this.plugins = t.plugins, this.entries = Er(e), this.schemas = zr(e);
		let n = 0;
		for (let { path: e, descriptor: t } of this.entries) n = wr(n), this.offsets.set(e, n), n += t.byteLength;
		this.versionOffset = wr(n), this.totalBytes = this.versionOffset + wr(this.entries.length * 4), Rr.push(this), xr.info(`contract defined: ${this.entries.length} field(s), ${br(this.totalBytes)}`, {
			fields: Object.fromEntries(this.entries.map((e) => [e.path, `${e.descriptor.kind}@${this.offsets.get(e.path)?.toLocaleString()}+${br(e.descriptor.byteLength)}`])),
			pluginOverrides: Object.keys(this.plugins ?? {})
		});
	}
	bind(e) {
		this.connectors.clear();
		let t = new Int32Array(e, this.versionOffset, this.entries.length);
		this.entries.forEach(({ path: n, descriptor: r }, i) => {
			let a = this.plugins?.[r.kind] ?? Dr.get(r.kind);
			if (!a) throw Error(`Unknown shared memory field kind: ${r.kind}`);
			xr.debug(`bind "${n}" (${r.kind}, ${br(r.byteLength)}) via ${this.plugins?.[r.kind] ? "plugin" : "built-in"} factory`);
			let o = a(r, {
				buffer: e,
				codec: this.codec,
				version: {
					view: t,
					index: i
				},
				path: n
			}, this.offsets.get(n)), s = o.commit;
			this.connectors.set(n, {
				...o,
				write: (e) => {
					o.write(e);
					let r = Atomics.add(t, i, 1);
					Atomics.notify(t, i), Pn() && (Nn({
						type: "memory:write",
						path: n,
						version: r + 1
					}), Xn.size && cr(this, n, r + 1));
				},
				...s && Pn() ? { commit: () => {
					s(), Xn.size && cr(this, n, Atomics.load(t, i));
				} } : {},
				_version: {
					view: t,
					index: i
				},
				_path: n
			});
		}), Pn() && (dr(() => Rr), Nn({
			type: "memory:bind",
			fields: this.entries.map((e, t) => [t, e.path]),
			totalBytes: this.totalBytes
		})), this.isBound = !0, this.boundBuffer = e;
		for (let e of [...this.boundListeners]) e();
	}
	get bound() {
		return this.isBound;
	}
	get buffer() {
		if (!this.boundBuffer) throw Error("Shared memory contract is not bound to a buffer on this thread.");
		return this.boundBuffer;
	}
	fields() {
		return this.entries.map(({ path: e, descriptor: t }) => ({
			path: e,
			byteOffset: this.offsets.get(e),
			byteLength: t.byteLength
		}));
	}
	onBound(e) {
		return this.boundListeners.add(e), this.isBound && e(), () => this.boundListeners.delete(e);
	}
	connector(e) {
		let t = String(e), n = this.connectors.get(t);
		if (!n) throw Error(`Shared memory field "${t}" was accessed before the buffer was bound on this thread.`);
		return n;
	}
};
function Hr(e, t = {}) {
	let n = new Vr(e, t);
	for (let [t, r] of Object.entries(e)) if (Tr(r)) Object.defineProperty(n, t, {
		enumerable: !0,
		get: () => n.connector(t)
	});
	else {
		let e = {};
		for (let i of Object.keys(r)) Object.defineProperty(e, i, {
			enumerable: !0,
			get: () => n.connector(`${t}.${i}`)
		});
		Object.defineProperty(n, t, {
			enumerable: !0,
			get: () => e
		});
	}
	return n;
}
function Ur(e) {
	for (let t of Rr) t.bind(e);
	xr.info(`bound ${Rr.length} contract(s) — ${br(e.byteLength)} buffer`);
}
function Wr() {
	return Rr.length;
}
//#endregion
//#region ../../src/pool/memory.ts
var Gr = (e, t, n, r) => {
	let i = globalThis.performance;
	if (typeof i?.measure == "function") try {
		i.measure(e, {
			start: t,
			end: Math.max(n, t),
			detail: { devtools: {
				dataType: "track-entry",
				track: r.track,
				trackGroup: "atoll",
				color: r.color ?? "primary",
				properties: r.properties,
				tooltipText: r.tooltipText
			} }
		}), i.clearMeasures?.(e);
	} catch {}
}, Kr = yr("registry"), qr = class {
	static tasks = /* @__PURE__ */ new Map();
	static register(e, t) {
		this.tasks.set(e.taskId, {
			contract: e,
			handler: t
		}), Kr.debug(`registered "${e.taskId}"`, {
			args: e.argsSchema ? "validated" : "unvalidated",
			result: e.resultSchema ? "validated" : "unvalidated"
		});
	}
	static getContract(e) {
		return this.tasks.get(e)?.contract;
	}
	static async execute(e, ...t) {
		let n = this.tasks.get(e);
		if (!n) throw Error(`Task handler not found for id: ${e}`);
		let { contract: r, handler: i } = n, a = await i(...r.argsSchema ? r.argsSchema.parse(t) : t);
		return r.resultSchema ? r.resultSchema.parse(a) : a;
	}
}, Jr = yr("worker"), Yr = (e, t, n, r) => {
	let i = performance.now();
	Gr(`atoll run ${e}`, n, i, {
		track: "tasks",
		color: r ? "secondary" : "error",
		properties: [["message", t], ["outcome", r ? "ok" : "error"]],
		tooltipText: `${e}: ${(i - n).toFixed(1)}ms in worker`
	});
}, Xr = !1, Zr = !1;
function Qr() {
	if (!Zr) {
		if (typeof self > "u") {
			Jr.warn("workerBootstrap: no worker global found — skipping message wiring");
			return;
		}
		Zr = !0, self.onmessage = async (e) => {
			let t = e.data;
			if (t.type === "INIT") {
				Xr = !0, t.devtools && zn(), Wr() > 0 && Jr.warn("pool sent INIT without memory, but shared-memory contracts are defined — field access will throw until bound"), Jr.info("initialized (message-only pool — no shared memory)");
				return;
			}
			if (t.type === "INIT_MEMORY") {
				let e = t.memory?.buffer ?? t.buffer;
				if (!e) {
					Jr.warn("INIT_MEMORY arrived without a buffer — contracts stay unbound");
					return;
				}
				Ur(e), Xr = !0, t.devtools && zn(), Jr.info(`shared memory initialized (${br(e.byteLength)})`);
				return;
			}
			if (t.type === "EXECUTE_TASK") {
				let { messageId: e, taskId: n, args: r } = t;
				if (!Xr) {
					Jr.warn(`rejected ${n} — shared memory not initialized`), self.postMessage({
						messageId: e,
						success: !1,
						error: "Shared memory not initialized in worker."
					});
					return;
				}
				let i = performance.now();
				try {
					let t = await qr.execute(n, ...r || []);
					Pn() && Yr(n, e, i, !0), Jr.debug(`task ${n} → ${(performance.now() - i).toFixed(1)}ms`), self.postMessage({
						messageId: e,
						success: !0,
						result: t
					});
				} catch (t) {
					Pn() && Yr(n, e, i, !1), Jr.warn(`task ${n} failed: ${t.message || String(t)}`), self.postMessage({
						messageId: e,
						success: !1,
						error: t.message || String(t)
					});
				}
			}
		};
	}
}
Qr();
//#endregion
//#region ../../src/worker/defineWorker.ts
var j = yr("worker"), $r = [
	"start",
	"terminate",
	"pool",
	"sharedMemory",
	"then",
	"with"
], ei = (e) => typeof e == "object" && !!e && "run" in e, ti = new Set($r);
function ni(e) {
	Qr();
	let t = e.methods ?? {}, n = e.services ?? {}, r = 0, i = (e, t, n, i) => {
		if (ti.has(t)) throw Error(`defineWorker: "${t}" is reserved for the client API — rename the method`);
		if (ei(n)) {
			let { def: t } = n;
			qr.register({
				taskId: t.taskId ?? e,
				...t.dataType ? { dataType: t.dataType } : {},
				...t.argsSchema ? { argsSchema: t.argsSchema } : {},
				...t.resultSchema ? { resultSchema: t.resultSchema } : {}
			}, n.run.bind(n));
		} else qr.register({ taskId: e }, n.bind(i));
		r++;
	};
	for (let [e, n] of Object.entries(t)) i(e, e, n, t);
	for (let [e, t] of Object.entries(n)) {
		if (ti.has(e)) throw Error(`defineWorker: service name "${e}" is reserved for the client API — rename it`);
		for (let [n, r] of Object.entries(t)) i(`${e}.${n}`, n, r, t);
	}
	j.info(`worker defined — ${r} method(s)`);
	let a = {
		methods: t,
		services: n
	};
	return e.sharedMemory && (a.sharedMemory = e.sharedMemory), a;
}
//#endregion
//#region ../../node_modules/solid-js/dist/solid.js
var ri = {
	context: void 0,
	registry: void 0,
	effects: void 0,
	done: !1,
	getContextId() {
		return ii(this.context.count);
	},
	getNextContextId() {
		return ii(this.context.count++);
	}
};
function ii(e) {
	let t = String(e), n = t.length - 1;
	return ri.context.id + (n ? String.fromCharCode(96 + n) : "") + t;
}
var ai = { equals: (e, t) => e === t }, oi = null, si = Ei, ci = 1, li = 2, ui = null, M = null, di = null, fi = null, pi = null, mi = 0;
function hi(e, t) {
	t = t ? Object.assign({}, ai, t) : ai;
	let n = {
		value: e,
		observers: null,
		observerSlots: null,
		comparator: t.equals || void 0
	};
	return [yi.bind(n), (e) => (typeof e == "function" && (e = M && M.running && M.sources.has(n) ? e(n.tValue) : e(n.value)), bi(n, e))];
}
function gi(e) {
	if (di === null) return e();
	let t = di;
	di = null;
	try {
		return e();
	} finally {
		di = t;
	}
}
var [_i, vi] = /*@__PURE__*/ hi(!1);
function yi() {
	let e = M && M.running;
	if (this.sources && (e ? this.tState : this.state)) {
		if ((e ? this.tState : this.state) === ci) xi(this);
		else {
			let e = fi;
			fi = null, wi(() => Di(this), !1), fi = e;
		}
	}
	if (di) {
		let e = this.observers;
		if (!e || e[e.length - 1] !== di) {
			let t = e ? e.length : 0;
			di.sources ? (di.sources.push(this), di.sourceSlots.push(t)) : (di.sources = [this], di.sourceSlots = [t]), e ? (e.push(di), this.observerSlots.push(di.sources.length - 1)) : (this.observers = [di], this.observerSlots = [di.sources.length - 1]);
		}
	}
	return e && M.sources.has(this) ? this.tValue : this.value;
}
function bi(e, t, n) {
	let r = M && M.running && M.sources.has(e) ? e.tValue : e.value;
	if (!e.comparator || !e.comparator(r, t)) {
		if (M) {
			let r = M.running;
			(r || !n && M.sources.has(e)) && (M.sources.add(e), e.tValue = t), r || (e.value = t);
		} else e.value = t;
		e.observers && e.observers.length && wi(() => {
			for (let t = 0; t < e.observers.length; t += 1) {
				let n = e.observers[t], r = M && M.running;
				r && M.disposed.has(n) || ((r ? !n.tState : !n.state) && (n.pure ? fi.push(n) : pi.push(n), n.observers && Oi(n)), r ? n.tState = ci : n.state = ci);
			}
			if (fi.length > 1e6) throw fi = [], Error();
		}, !1);
	}
	return t;
}
function xi(e) {
	if (!e.fn) return;
	ki(e);
	let t = mi;
	Si(e, M && M.running && M.sources.has(e) ? e.tValue : e.value, t), M && !M.running && M.sources.has(e) && queueMicrotask(() => {
		wi(() => {
			M && (M.running = !0), di = ui = e, Si(e, e.tValue, t), di = ui = null;
		}, !1);
	});
}
function Si(e, t, n) {
	let r, i = ui, a = di;
	di = ui = e;
	try {
		r = e.fn(t);
	} catch (t) {
		return e.pure && (M && M.running ? (e.tState = ci, e.tOwned && e.tOwned.forEach(ki), e.tOwned = void 0) : (e.state = ci, e.owned && e.owned.forEach(ki), e.owned = null)), e.updatedAt = n + 1, Ni(t);
	} finally {
		di = a, ui = i;
	}
	(!e.updatedAt || e.updatedAt <= n) && (e.updatedAt != null && "observers" in e ? bi(e, r, !0) : M && M.running && e.pure ? (M.sources.has(e) || (e.value = r), M.sources.add(e), e.tValue = r) : e.value = r, e.updatedAt = n);
}
function Ci(e) {
	let t = M && M.running;
	if ((t ? e.tState : e.state) === 0) return;
	if ((t ? e.tState : e.state) === li) return Di(e);
	if (e.suspense && gi(e.suspense.inFallback)) return e.suspense.effects.push(e);
	let n = [e];
	for (; (e = e.owner) && (!e.updatedAt || e.updatedAt < mi);) {
		if (t && M.disposed.has(e)) return;
		(t ? e.tState : e.state) && n.push(e);
	}
	for (let r = n.length - 1; r >= 0; r--) {
		if (e = n[r], t) {
			let t = e, i = n[r + 1];
			for (; (t = t.owner) && t !== i;) if (M.disposed.has(t)) return;
		}
		if ((t ? e.tState : e.state) === ci) xi(e);
		else if ((t ? e.tState : e.state) === li) {
			let t = fi;
			fi = null, wi(() => Di(e, n[0]), !1), fi = t;
		}
	}
}
function wi(e, t) {
	if (fi) return e();
	let n = !1;
	t || (fi = []), pi ? n = !0 : pi = [], mi++;
	try {
		let t = e();
		return Ti(n), t;
	} catch (e) {
		n || (pi = null), fi = null, Ni(e);
	}
}
function Ti(e) {
	if (fi &&= (Ei(fi), null), e) return;
	let t;
	if (M) {
		if (!M.promises.size && !M.queue.size) {
			let e = M.sources, n = M.disposed;
			pi.push.apply(pi, M.effects), t = M.resolve;
			for (let e of pi) "tState" in e && (e.state = e.tState), delete e.tState;
			M = null, wi(() => {
				for (let e of n) ki(e);
				for (let t of e) {
					if (t.value = t.tValue, t.owned) for (let e = 0, n = t.owned.length; e < n; e++) ki(t.owned[e]);
					t.tOwned && (t.owned = t.tOwned), delete t.tValue, delete t.tOwned, t.tState = 0;
				}
				vi(!1);
			}, !1);
		} else if (M.running) {
			M.running = !1, M.effects.push.apply(M.effects, pi), pi = null, vi(!0);
			return;
		}
	}
	let n = pi;
	pi = null, n.length && wi(() => si(n), !1), t && t();
}
function Ei(e) {
	for (let t = 0; t < e.length; t++) Ci(e[t]);
}
function Di(e, t) {
	let n = M && M.running;
	n ? e.tState = 0 : e.state = 0;
	for (let r = 0; r < e.sources.length; r += 1) {
		let i = e.sources[r];
		if (i.sources) {
			let e = n ? i.tState : i.state;
			e === ci ? i !== t && (!i.updatedAt || i.updatedAt < mi) && Ci(i) : e === li && Di(i, t);
		}
	}
}
function Oi(e) {
	let t = M && M.running;
	for (let n = 0; n < e.observers.length; n += 1) {
		let r = e.observers[n];
		(t ? !r.tState : !r.state) && (t ? r.tState = li : r.state = li, r.pure ? fi.push(r) : pi.push(r), r.observers && Oi(r));
	}
}
function ki(e) {
	let t;
	if (e.sources) for (; e.sources.length;) {
		let t = e.sources.pop(), n = e.sourceSlots.pop(), r = t.observers;
		if (r && r.length) {
			let e = r.pop(), i = t.observerSlots.pop();
			n < r.length && (e.sourceSlots[i] = n, r[n] = e, t.observerSlots[n] = i);
		}
	}
	if (e.tOwned) {
		for (t = e.tOwned.length - 1; t >= 0; t--) ki(e.tOwned[t]);
		delete e.tOwned;
	}
	if (M && M.running && e.pure) Ai(e, !0);
	else if (e.owned) {
		for (t = e.owned.length - 1; t >= 0; t--) ki(e.owned[t]);
		e.owned = null;
	}
	if (e.cleanups) {
		for (t = e.cleanups.length - 1; t >= 0; t--) e.cleanups[t]();
		e.cleanups = null;
	}
	M && M.running ? e.tState = 0 : e.state = 0;
}
function Ai(e, t) {
	if (t || (e.tState = 0, M.disposed.add(e)), e.owned) for (let t = 0; t < e.owned.length; t++) Ai(e.owned[t]);
}
function ji(e) {
	return e instanceof Error ? e : Error(typeof e == "string" ? e : "Unknown error", { cause: e });
}
function Mi(e, t, n) {
	try {
		for (let n of t) n(e);
	} catch (e) {
		Ni(e, n && n.owner || null);
	}
}
function Ni(e, t = ui) {
	let n = oi && t && t.context && t.context[oi], r = ji(e);
	if (!n) throw r;
	pi ? pi.push({
		fn() {
			Mi(r, n, t);
		},
		state: ci
	}) : Mi(r, n, t);
}
typeof WorkerGlobalScope < "u" && self instanceof WorkerGlobalScope;
//#endregion
//#region ../../src/reactiveGraph.ts
var Pi = u(), Fi = "islandContract", Ii = "appContract";
function Li(e) {
	return {
		...e,
		[Fi]: !0
	};
}
var Ri = (e) => typeof e == "object" && !!e && e[Fi] === !0;
function zi(e, t) {
	return t[Ii] = e, t;
}
var Bi = (e) => {
	if (typeof e != "object" && typeof e != "function" || e === null) return;
	let t = e[Ii];
	return Ri(t) ? t : void 0;
}, Vi = "islandAppName", Hi = (e) => {
	if (typeof e == "string") return e === "" ? void 0 : e;
	if (e === null || typeof e != "function" && typeof e != "object") return;
	if (Ri(e)) return e.app === "" ? void 0 : e.app;
	let t = e[Vi];
	if (typeof t == "string" && t !== "") return t;
	if (typeof e == "function") {
		let t = e;
		return t.displayName ?? (t.name === "" ? void 0 : t.name);
	}
	let n = e.imperative;
	if (typeof n == "function") {
		let e = n[Vi];
		return typeof e == "string" && e !== "" ? e : n.name === "" ? void 0 : n.name;
	}
}, Ui = Hr({ opsVersion: Nr.number() }), Wi = "__island_cb__", Gi = "__cb", Ki = (e) => {
	if (typeof e != "object" || !e) return !1;
	let t = Object.getPrototypeOf(e);
	return t === Object.prototype || t === null;
};
function qi(e, t) {
	if (Array.isArray(e)) return e.map((e) => qi(e, t));
	if (!Ki(e)) return e;
	let n = e[Gi];
	if (typeof n == "number" && Object.keys(e).length === 1) return t(n);
	let r = {};
	for (let [n, i] of Object.entries(e)) r[n] = qi(i, t);
	return r;
}
//#endregion
//#region ../../packages/islands/src/metrics.ts
var Ji = {
	enabled: !1,
	depth: 0,
	recordMs: 0,
	opsPushed: 0,
	reset() {
		this.depth = 0, this.recordMs = 0, this.opsPushed = 0;
	}
}, Yi = () => (Ji.depth++, Ji.depth === 1 ? performance.now() : -1), Xi = (e) => {
	Ji.depth--, e >= 0 && (Ji.recordMs += performance.now() - e);
}, Zi = (e) => {
	if (!Ji.enabled) return e();
	let t = Yi();
	try {
		return e();
	} finally {
		Xi(t);
	}
};
Object.freeze({ id: 0 });
var Qi = /* @__PURE__ */ new Map(), $i = "", ea = /* @__PURE__ */ new Map(), ta = /* @__PURE__ */ new Map(), na = 1, ra = 1, ia = /* @__PURE__ */ new Map(), aa = (e, t) => {
	t === void 0 ? ia.delete(e) : ia.set(e, t);
}, oa = () => na++, sa = "", ca = (e) => {
	let t = $i;
	return $i = e, e !== "" && (sa = e), t;
}, la = () => $i, ua = () => sa, da = (e, t) => {
	let n = ca(e);
	try {
		return t();
	} finally {
		ca(n);
	}
}, N = (e, t) => Zi(() => {
	let n = Qi.get(e);
	n || Qi.set(e, n = []), n.push(t), Ji.opsPushed++;
}), fa = Ui, pa = (e) => {
	fa = e;
}, ma = () => {
	if (!fa.bound) return;
	let e = fa.connector("opsVersion");
	e.write(Number(e.read() ?? 0) + 1);
}, ha = (e) => Zi(() => {
	let t = Qi.get(e);
	return !t || t.length === 0 ? [] : (Qi.set(e, []), t);
}), ga = (e) => ta.get(e), _a = /* @__PURE__ */ new Map(), va = (e) => _a.get(e), ya = (e, t, n) => {
	_a.set(e, {
		w: t,
		h: n
	});
}, ba = (e, t, n) => Zi(() => {
	let r = ra++;
	return ta.set(r, {
		fn: e,
		instance: t,
		instanceId: n
	}), r;
}), xa = (e) => {
	Zi(() => {
		ta.delete(e);
	});
}, Sa = (e, t) => {
	Zi(() => {
		let n = ia.get($i)?.events?.[e];
		if (n !== void 0) try {
			t = n.parse(t);
		} catch (t) {
			throw Error(`emit("${e}") rejected by the island contract for "${$i}": ` + (t instanceof Error ? t.message : String(t)));
		}
		N($i, {
			t: "emit",
			name: e,
			payload: t
		});
	});
};
function Ca(e, t) {
	return Zi(() => {
		let n = {};
		for (let [r, i] of Object.entries(t)) if (i != null && r !== "children" && r !== "key" && r !== "ref" && r !== "dangerouslySetInnerHTML") {
			if (typeof i == "function") {
				if (r.length > 2 && r.startsWith("on")) {
					let t = e.listenerSlots[r];
					t === void 0 && (t = ra++, e.listenerSlots[r] = t), ta.set(t, {
						fn: i,
						instance: e.instance,
						instanceId: e.id
					}), n[r] = { __evt: t };
				}
				continue;
			}
			n[r] = i;
		}
		return n;
	});
}
function wa(e, t, n, r) {
	return Zi(() => {
		let i = {
			kind: "element",
			id: oa(),
			type: e,
			ns: n,
			instance: r,
			props: {},
			listenerSlots: {}
		};
		return i.props = Ca(i, t), ea.set(i.id, i), i;
	});
}
function Ta(e, t) {
	return Zi(() => {
		let n = {
			kind: "text",
			id: oa(),
			text: e,
			instance: t
		};
		return ea.set(n.id, n), n;
	});
}
//#endregion
//#region ../../packages/islands/src/worker/dom/node.ts
var Ea = (e) => {
	let t = typeof e == "boolean" ? { capture: e } : e ?? {};
	return {
		once: t.once === !0,
		passive: t.passive === !0,
		capture: t.capture === !0
	};
}, Da = (e) => {
	let t = Ea(e);
	return t.once || t.passive || t.capture ? {
		once: t.once,
		passive: t.passive,
		capture: t.capture
	} : void 0;
}, Oa = (e) => e.replace(/[A-Z]/g, (e) => `-${e.toLowerCase()}`), ka = (e) => e.replace(/-([a-z])/g, (e, t) => t.toUpperCase()), Aa = -1, ja = () => Aa--, Ma = (e) => {
	throw Error("proxyDom.insertBefore: child is not a proxy node — the ambient `document`/`createElement` resolved a foreign DOM (a stale override or the real one), so this node was created outside the instance that owns the parent");
}, Na = (e) => {
	let t = e._parent;
	t instanceof Fa ? t._detach(e) : e._parent = null;
}, Pa = (e, t) => typeof t == "string" ? e.createTextNode(t) : t, Fa = class e {
	instance;
	doc;
	_parent = null;
	_children = [];
	constructor(e, t) {
		this.doc = e, this.instance = t;
	}
	get nodeType() {
		return 0;
	}
	get nodeName() {
		switch (this.nodeType) {
			case 1: {
				let e = this.instance;
				return e.ns === void 0 ? e.type.toUpperCase() : e.type;
			}
			case 3: return "#text";
			case 8: return "#comment";
			case 11: return "#document-fragment";
			default: return "#node";
		}
	}
	get ownerDocument() {
		return this.doc;
	}
	get parentNode() {
		return this._parent;
	}
	get parentElement() {
		return this._parent !== null && this._parent.nodeType === 1 ? this._parent : null;
	}
	get childNodes() {
		return this._children.slice();
	}
	get firstChild() {
		return this._children[0] ?? null;
	}
	get lastChild() {
		return this._children[this._children.length - 1] ?? null;
	}
	get nextSibling() {
		let e = this._parent;
		return e === null ? null : e._children[e._children.indexOf(this) + 1] ?? null;
	}
	get previousSibling() {
		let e = this._parent;
		if (e === null) return null;
		let t = e._children.indexOf(this);
		return t > 0 ? e._children[t - 1] : null;
	}
	get isConnected() {
		let e = this;
		for (; e !== null;) {
			if (e === this.doc._root) return !0;
			e = e._parent;
		}
		return !1;
	}
	getRootNode() {
		let e = this;
		for (; e._parent !== null;) e = e._parent;
		return e;
	}
	get textContent() {
		let e = "";
		for (let t of this._children) t.nodeType !== 8 && (e += t.textContent);
		return e;
	}
	set textContent(e) {
		this.doc._assertAlive();
		let t = String(e);
		for (let e of this._children) e._parent = null;
		this._children = t === "" ? [] : [this.doc._phantomText(this, t)], this._op({
			t: "utext",
			id: this.instance.id,
			text: t
		});
	}
	contains(e) {
		let t = e;
		for (; t !== null;) {
			if (t === this) return !0;
			t = t._parent;
		}
		return !1;
	}
	appendChild(e) {
		return this.insertBefore(e, null);
	}
	insertBefore(t, n) {
		if (this.doc._assertAlive(), this.nodeType === 3 || this.nodeType === 8) throw Error(`proxyDom.insertBefore: ${this.nodeName} nodes cannot have children`);
		if (t instanceof e || Ma(t), t instanceof Ra) {
			for (let e of t._children.slice()) this.insertBefore(e, n);
			return t;
		}
		let r;
		if (n === null) Na(t), t._parent = this, this._children.push(t);
		else {
			let e = this._children.indexOf(n);
			if (e === -1) throw Error("proxyDom.insertBefore: reference node is not a child of this node");
			Na(t), t._parent = this, this._children.splice(e, 0, t), n.instance.id > 0 && (r = n.instance.id);
		}
		return this.instance.id >= 0 && t.instance.id > 0 && this._op({
			t: "append",
			parent: this.instance.id,
			child: t.instance.id,
			before: r
		}), t;
	}
	removeChild(e) {
		this.doc._assertAlive();
		let t = this._children.indexOf(e);
		if (t === -1) throw Error("proxyDom.removeChild: node is not a child of this node");
		return this._children.splice(t, 1), e._parent = null, this.instance.id >= 0 && e.instance.id > 0 && this._op({
			t: "remove",
			child: e.instance.id
		}), e;
	}
	remove() {
		this._parent?.removeChild(this);
	}
	before(...e) {
		let t = this._parent;
		if (t !== null) for (let n of e) t.insertBefore(Pa(this.doc, n), this);
	}
	after(...e) {
		let t = this._parent;
		if (t === null) return;
		let n = this.nextSibling;
		for (let r of e) t.insertBefore(Pa(this.doc, r), n);
	}
	replaceWith(...e) {
		let t = this._parent;
		if (t !== null) {
			for (let n of e) t.insertBefore(Pa(this.doc, n), this);
			t.removeChild(this);
		}
	}
	append(...e) {
		this.doc._assertAlive();
		for (let t of e) this.appendChild(Pa(this.doc, t));
	}
	prepend(...e) {
		this.doc._assertAlive();
		let t = this.firstChild;
		for (let n of e) this.insertBefore(Pa(this.doc, n), t);
	}
	replaceChildren(...e) {
		this.doc._assertAlive();
		for (let e of this._children.slice()) this.removeChild(e);
		this.append(...e);
	}
	cloneNode(e) {
		throw Error("proxyDom.cloneNode: unsupported node kind");
	}
	_op(e) {
		N(this.instance.instance, e), la() !== this.instance.instance && ma();
	}
	_detach(e) {
		let t = this._children.indexOf(e);
		t !== -1 && this._children.splice(t, 1), e._parent = null;
	}
}, Ia = class extends Fa {
	constructor(e, t) {
		super(e, t);
	}
	get nodeType() {
		return 3;
	}
	get _utextTarget() {
		return this.instance.id > 0 ? this.instance.id : this._parent?.instance.id ?? this.instance.id;
	}
	get data() {
		return this.instance.text;
	}
	set data(e) {
		this._write(e);
	}
	get nodeValue() {
		return this.instance.text;
	}
	set nodeValue(e) {
		this._write(e);
	}
	get textContent() {
		return this.instance.text;
	}
	set textContent(e) {
		this._write(e);
	}
	_write(e) {
		this.doc._assertAlive();
		let t = String(e);
		this.instance.text = t, this._op({
			t: "utext",
			id: this._utextTarget,
			text: t
		});
	}
	cloneNode(e) {
		return this.doc.createTextNode(this.instance.text);
	}
}, La = class extends Ia {
	get nodeType() {
		return 8;
	}
	get data() {
		return this.instance.text;
	}
	set data(e) {
		this._shadowWrite(e);
	}
	get nodeValue() {
		return this.instance.text;
	}
	set nodeValue(e) {
		this._shadowWrite(e);
	}
	get textContent() {
		return this.instance.text;
	}
	set textContent(e) {
		this._shadowWrite(e);
	}
	_shadowWrite(e) {
		this.doc._assertAlive(), this.instance.text = String(e);
	}
	cloneNode(e) {
		return this.doc.createComment(this.data);
	}
}, Ra = class extends Fa {
	get nodeType() {
		return 11;
	}
	cloneNode(e) {
		let t = this.doc.createDocumentFragment();
		if (e === !0) for (let e of this._children) t.appendChild(e.cloneNode(!0));
		return t;
	}
}, za = [
	8364,
	0,
	8218,
	402,
	8222,
	8230,
	8224,
	8225,
	710,
	8240,
	352,
	8249,
	338,
	0,
	381,
	0,
	0,
	8216,
	8217,
	8220,
	8221,
	8226,
	8211,
	8212,
	732,
	8482,
	353,
	8250,
	339,
	0,
	382,
	376
];
function Ba(e) {
	return e === 0 || e >= 55296 && e <= 57343 || e > 1114111;
}
function Va(e) {
	return Ba(e) ? 65533 : e >= 128 && e <= 159 && za[e - 128] || e;
}
function Ha(e) {
	return Ba(e) ? 65533 : e;
}
//#endregion
//#region ../../node_modules/htmlparser2/node_modules/entities/dist/internal/decode-shared.js
var Ua = /* #__PURE__ */ (() => {
	let e = /* @__PURE__ */ new Uint8Array(127), t = 0;
	for (let n = 33; n <= 126; n++) n !== 34 && n !== 36 && n !== 92 && (e[n] = t++);
	return e;
})();
function Wa(e, t, n, r, i, a) {
	let o = e.length, s = a * 90, c = 0, l = () => {
		let t = Ua[e.charCodeAt(c++)];
		return t < a ? t : t * 91 - s + Ua[e.charCodeAt(c++)];
	}, u = n - r, d = n + i, f = new Int32Array(d);
	f.fill(-1, r, a), f.fill(-1, a + u, d);
	let p = new Int32Array(d), m = new Int32Array(d);
	function h(t, n) {
		let r = 0, i = n, a = n + t;
		for (; i < a;) {
			let t = Ua[e.charCodeAt(c++)];
			if (t < 89) r += t, f[i++] = r;
			else if (t === 89) {
				let t = Ua[e.charCodeAt(c++)] + 2;
				for (; t--;) f[i++] = ++r;
			} else {
				let t = Ua[e.charCodeAt(c++)];
				r += 89 + (t < 90 ? t * 91 + Ua[e.charCodeAt(c++)] : Ua[e.charCodeAt(c++)] * 8281 + Ua[e.charCodeAt(c++)] * 91 + Ua[e.charCodeAt(c++)]), f[i++] = r;
			}
		}
	}
	h(r, 0), h(u, a);
	let g = new Int32Array(i * 2), _ = 0, v = 0;
	function y(e, t) {
		for (let n = 0; n < e; n++) {
			let e = t + n, r = l(), i = l();
			g[v * 2] = r, g[v * 2 + 1] = i, v += 1, p[e] = _;
			let a = (f[r] < 0 ? m[r] : 1) + (f[i] < 0 ? m[i] : 1);
			m[e] = a, _ += a;
		}
	}
	y(i - a + r, a + u), y(a - r, r);
	let ee = new Uint16Array(_), te = 0;
	for (let e = 0; e < v; e++) for (let t = 0; t < 2; t++) {
		let n = g[e * 2 + t], r = f[n];
		if (r < 0) {
			let e = p[n], t = e + m[n];
			for (; e < t;) ee[te++] = ee[e++];
		} else ee[te++] = r;
	}
	let b = new Uint16Array(t), x = 0;
	for (; c < o;) {
		let t = Ua[e.charCodeAt(c++)];
		t >= a && (t = t * 91 - s + Ua[e.charCodeAt(c++)]);
		let n = f[t];
		if (n < 0) {
			let e = p[t], n = e + m[t];
			for (; e < n;) b[x++] = ee[e++];
		} else b[x++] = n;
	}
	return b;
}
//#endregion
//#region ../../node_modules/htmlparser2/node_modules/entities/dist/generated/decode-data-html.js
var Ga = /* #__PURE__ */ Wa("!}.&u%}'&}*'~!6*)%&,~!J~!J~%L~y<~!R,~~%Lu~~#GD~~#|)1#%}^%}2%+#.##%##%}&%##%'#%##&%#%#'%#&#%#&#'#%%#&#%##%#)%''%&%#%#'%#%%#%%}%%%#%#&(23#%%#&-%0%('1#(##%#'##+%'*.:1}#%#6-+(%'%%#%%%}#L'2351&('%}&/N'(0(/*-%(%%}#'+&T%7.2}#&%&#%#36/5##%&%%#&#%%#))2%%##%&&'0~!#*+&'%1~!%).'3q?&%'1~!.##%6(~!+%%%(Gw'rT~!E#<nA%#jZ~!H%(~!42##~!*31&~!G%U~#)5~#`3~!J~!Z~%]~%Y~%C~!q~!u~#kz~%#~!6'~!D~!U~!?~#T~!c%~!G#'~%7|~!G~!J~!G&~#pb~(Df}#%}*&}#%##%##%##&#-}&'#'&%#.++}%mI,#,@&(}*%}*'%&##&#%##%}&0}#.},U},%}+%}&%}#%##&}B%(}(%}+%)})%##%#&}&%##%&}<%}>%#%&}*%}(%}9%}/%})%}*%}*%}?&}&%}3%}&*#%})%#%#)}#&#-#+*%E%%'%'#%}#*V##&##I}#&&##%&%#&&Qf%%))w/0+&%#(#.%-''''++++7}>%4'',##1,#%#&%##&#'##&#*#9)%&%}#*}%,#+P(%A&%#'&##wSD',9E00#y#@}(+}&%&>~!#~!X}#*}(&&}(&}(,%}%&#+&}#&}I%#%}%)#(},'%#*}4%%#%}(''}#/##(##),%-##%%)#&}(.}&%#&}%%}*&#%},&&}&%}#%*'#%})%}D&}&%}-&}6&#&}-,%}#%})-(~+`~,=?~I9'9%~!,#%})%})%}@%}?%}(~!?~#<~#pP~#BG~#=1#%K+~#?#~%;)~#A~#mF1~#A'~'X%'~#lR~#N~'N~#r~#m#-~#i'?%#'%~#B%##%,%#~#_%#0%~#]732~,w~2+#:&#%&'0%&>%}#>##F+)#%&&#(+_}4&}-%}(&}@&}O7Fdf0@+/v4}&WU##&/0#&'('B#%}.%}'+#%}#%%&#&%#%##+#&#)#6#'#.},%}c%},%#%##%&#&%#&~#>'*-.%##%##%}#%%}%'~#)D1}#%*&~#_%%'(~#S2%'.}#~#=##*'*-%}&'%'##&&~'E%.#&~#M4}%%##&'%#~#O1##%&#'+~#<B%##%%'%+~#;#@%}#&%#&&%#(~#H1}'%'##&&~#?A}&'~#D#%32}'&&&&~#[}'(#%}'~#;C})&}%%#%~#=&%,3}%'(#%%~#^'#&&)#%'~#Y%-~#d-%'~#^%%&#&&&}#~#b~2t*&'~&(~&@~0%~e~3}%*''0})&}+~!9##-}#%-hD*)1fC#%/&/fB#40~!+#)*4~!+~!K'&:~!/*7~!.#~!H~!L':~%x&~!H#~!*~%1~!I#~!+A~#p'~!F~~#-#~,,(~.Z~!V~%;'B'mq-W~!N~%I%#&&#&}#%},%%}'%}+X#%}#&}(%}'%}<%}#%}%%'}'%}:~![)9@~%>~#UA%-%##&~!C%~!-.9:~!1~!-^2/:a~!y,D*J#-5)/4~%23,~#G~!L1~!0X3`~!2+~!!0-~&E~!W~!o,>Y&]~%cZx_&~#O*9#A#'#+I'%#)~!0B*-5A+-((F&*M#)(-7-5+'-3a5Vi~!Y~!?+[)%3),ERHm~!+:D,VG.+)?fB%%*(%)'(#&80%1'8`K8?`+'Z#&O&'H5#*9)A%%5&3))0%39+.*7#()&&*=4@**L)<'_&*+..;(#*+)./&0#3)%')-8(4ixD(&.}%,('aI:,)%,k2231T)I'#/-W7,/'Q#.'Y24+h')37</31&83##&0#),H(?'&?/1##%#&&#%''-%&&&#(&''&#.-'%#%%(,')*'&#&#'##%(%(#%('#&##%%%%('%#%#%%#%#&%##h>w+v<ayvyvcg.uuhKr}g/v|g>u9i[~>g5uI~=RvdwEg;v/g;uk!!TTSx]@RT!U!#!@VBRUU!'UTe-d0c`e&gSdicedFcrdTaqb.kYcAohdYd@a3e+d}dMdtd.aJ#bqcK`dle/e.e'dwdPdodddjbEb}ogd^ofdpduc6j?l%d{drdqc)d7bacOdQ%T#Y)X.sR[yH>6Vyv3[xwLu>vo'!*.[yBacahoj>6Rew3[xqdZa#!a&#^(X-[yG>6Vyu3[xvg3sEr|g.u/Ri9db0T#^(Xa)!-[y;>6Vylg4wKs{JwNZt3@3r=c4Z([xlg;wKt!cpq's@v7A'*a(a+!-a#[y<3Dt?3Dt'>6Vym3[xmg9rxsNJwLZt4~?r?db1T#`-!(Xa,!0[yS>6Vz%NuQs.g4wKtnJwNZtS@3r>c4Z([y%g;wKtrdga8!a(!#&T*Y-Xa#!a0<or[yc3Dtq>6Vz43[y3JwNZtf@3s!Ju}!%Dti:pm3c_%X#tjB5pkd6q!r]u?voC'*-a.a2!0a&a+[yI3DtI3Ds~3DtH>6Vyw3[xx;:s#~<5pKJwNZtE@3r~d`a)!a2T#a.(!+U.X1[yT3Dt`3Dtv>6Vz&3[y&g9rxwzcxstPu.<rAJwLZtT~?r@dZa%!a.&^*Za(/Reu[ya>6Vz23[y1g3sEr}wkg{NuQRg{ci(U#5@b`~,cg#U(2WnH5wugcRh7dX#T(Y,a'Ta!!a,[yZ<]mj>6Vz,3[y+Pv#5ReZKu+=,%!H}7ABwkaS?Rh:BcW(X#<]mrj:ubv/ARekdg%!(!a.*Ta(Y.X1!#sP>Rl*Dt6[y>>6Vyo3Wf*jOvuumvuRgRJuq*!:9<B@bX~3jVv&v@s@5Re[d/rQt{uAvo&a&a*)a2!,0Wf!3Dt0=Bs'>6Re}3[xy~<5s%JwJZt1~Gs)c;&!#2sJkNuXvzq7rxu,Re8dka4!a8(aEZ+a@Y.X1Xa)[yd=Bs(3DtP>6Vz53[y4cX#X&Re:avRe9~<5s&JwJZtQ~Gs*i^rzvdRg+Jv{%!2sbB@bX}kdga,!Za?&^*T1/!a'Dt+[y6>6Vyf3Wf%g/u;s4hGu6?Rh-JvZ,!c%#&RoX54Rivj7uyvf8RgTKvZB%*!2sGh<vu5Rgq<=C::9bb~#dZ#T&Ta6Y.X*Dt>[y93Wf)coZ(T,6VyifluvRgC@95@B@bX~/hFu34cC#T,k/unq8w8Q5RkUklwQuzunq8w8Q5Rk8d/rJu?v8w9)-&!a0a;a&aIWejg3sEr/h1s<DtDJvyZqY5aws3Jvy!&Wei~Hr1:au5@Bag>23E~5c:Z&bX};kKv?w&unuVu5Rjc;>bs)#~@:Rh.=ay<a]C;b`}Vd6s/t{uAvoaxa()!a,a7%-a#a2Dt,[yF2Wo[>6Vyt3[xuNuPRi&NuPwpi#RoWh?vf8Ri%Jv]!%Ri:KvxD!.'2WeAjZu`q9rxu,Re7woeAg-unLq(qA_/*2Wg_g3u5q^9:4E}/jTrxrzv=Wkkd~0UX#^^Xa-a1a5T&a=U1a'*aEa]!a*aPaA-adok[y54Rn>;:p3~Dp5g9rpsFNvZqjg3uJp4~<5p0Pw;5qlJwNZt*@3p1Pw:5p/Ou!5p2JvG'!6Vye=<qnJvh_[xhg3v,Rh3kOwOw-sDuev/Re^dha[a%!%!a+#Ta7)-5TaCaO!aka!a)sf[yb2>Rl!9ARiq5E}Qg=ucRkBE|oJrJ_@Wk~@Wk{JrJ_@Wk|@WkyJrJ_@Wk}@WkzJvO_[y2g-vMRmiKuYC!)&>Ri;>Ri<@3RkNc](X#@9Rk=g5vuRmhKvDB!+'=]meg3u4Rmgd)#Y'Vz3CARmfd`a+!%T'!+#Ta1Ta6TaM-sTDt9[yA9sYd'%Y#s[[xpj:ueunaXRgEjRq,v-vuqdd2'`#6Rev<32@5>:2<E}5xIo9a*X#Y(;5RePJvD_g>vyRgNj8w)v8<wggs:RgXiZt|vjx,hSq3ah!-(~@:Ro/Ou!5RhWj^v(pyw8unRhUdx-UY#^Ua.a3a70!)%UX1TaDa)'omRiRRhE[y:3Dsz=Br,>6Vyj3[xkg6ruwjcqsrPw;5r*Ku]D'Zt-@3r(~?r.i[vwv]dU1a--U#`a4(g/vsRhPOu!5RhLj:rmu9Wo!~@:wdh@g/vsRiTjXuvvNr}:RhBj^v(pyw8unRn]dz1UYa'a+^Y(!aETZalaRY.Ta?a4[yDJw1!#qLsW>6Vyrfzq-pLflpwRe|Js>%!Dt@3Dt&Jvy_[xs~HrnjMuwpsw'RecKu+D#'!t<~Grl~?rjg5u-x,gwp{ah!-(~@:Rg~Ou!5Rh'jXuvvNr}:Rh#cW#X/c;&!#2sLi[v7u7RgpJv)(!iLrxu,Re6j7v@s@5Se[e7d`aW!Za(a`T.a#!a3!&aDa-!9)Dt_=6s+3[x~~DR|h~DS6avhGun5RkZj3w)v-]mkKunB!&*]kb97R|i<ARk<c:Z(6Vy}Juh'!wziMRoS:F|vkLuauJv5vtvQRh1d='T+Y#VyO~DR|jcF#T'7R|g97R|kJv3'!ay<Rj,Jvh&!:ReXcsa6*a+#a#_aIRf9aLRf?c,Z&Rf5Rf7c.Z&Rf;Rf>cQ#%T'p-Rf8Rf=ct#%'(*!,p,Rf4p+Rf6Rf:Rf<d~'Ua%U*^UYa(!a,-!#a4YaTalaEX0a8a<Weo3Dt/3Dsx=Br93Wen~Dr;~<5p<JwNZt2@3p=Pw:5p;Ou!5r3c7&!#:p>3Ds}KvGB)_6Vyk2sM=<r7x'eovA(!hFu1ARf}cV#X&@r5j6rvwQa^Rf3c=Za'wkghJv__g;unRggA53B9=b^}%j6uduo5Jq;!(hIv%2Re`Ou4ARe_e%a#^^^Xa&!a*a2!&a6YaP!*ad!#a:aE/5Rn?[y@>6Vyp;:pE~DrY~<5pBJwNZt8@3pCh=rt3rWPw:5pAJup_[xoNuPpF9c!#'45pD5ARn)d8#X'X*3@rU72s]h>v<<sSjJpqvewOJq/(!hNw'5ReBk0s2u3w/w'5ReE5@Jq.!a+JQ!&WeU23d(#Y&RjG5]jBk!u7w&u0udARjEe#+^^^Ub#!a2/a`Z(agT1!a-a;|@TaG!aS[yV=Re~fow'RguNuPRe?bz#'>RoUWeL>:Cbb|?JwPZtVg6ruRmzJvD'!6Vz(g/vmRh~Jvy_[y(g9voRgyx*cy(#2>Ri2B9b]~9kIw9u7rluJu3Rg]dI#a%UY'@=p%CAx.gQZ&RhwwygtRm{x5g_Z'+ABqR9Woa=Bp&dV#^*Xa'!&@o{g4v]Rk;Jv{!%Rk[wkkiA5RkiwwfUB=x,fUuqC&*!>RfTg8v0RfV~ARfSd;rJsAuAv9wR'ae+/aO!a@aza/a#[yQ@Wg!2Wemg3sEr0JvB_g>uvReWg2v+Re=KupB_+[y!2AbY~-~Hr2AJwD!(h<~El>h<~El?Kun@+_:9b`}Kg-v/Ri3g;vtwyk_9]k_d=&T#*U.6qh@Ab`|K9:H|CJv[!&3Dtex'fDwC%!Rf[9WlMd[(^X,!a%Z06Vz!@WgBg=v~Rgvg,QRe@awd,#Y+jTv|Q~EfWj]uNr|~FRfXdy#Y&^Ua%!aO.!(a)Ua;=!a@aKap!a-,a!Ta]a[rSa]p?[y82sK=Bq~;:p:~<5p8Pw:5p7d'#Y'Wf(;RnRi[u4w&RgJJvG'!6Vyh=<r#ijuuv/sIKuYD'ZtG@3p9~Gr&d2#`(g<vtRgFj`u5w&rqpxRf2CJuY!+:wfnTOu!5Rg}jNs1ucv&RfwJvA!&3@q|BDcC#T,k/unq8w8Q5RkTklwQuzunq8w8Q5Rk9dga#!a'!a=#a0!:+Tb*b@aO.a4!aba8aFJv^}?!VyR~Dr<g;u%Rn.~<5p[x'e`wNZtR@3p]Pw:5pZhNvjBp.woe_g5u-r4JwF!%DtO3:ooc7&!#:p^3DtpLuGw(!+%)Dtk6Vz#2sd=<r8d'#Y([y#<x3gJt`w@!)%}MRiowzikRij=]ilxAf3,U(#B2Rf#g0v-Rm[ck{`U#]giKv3>)!&6Ri154s,KuGB_%@r68r:dJ|t`#X(9<E|u2@H|rx3gJu?w'!+'1Nu7Reg4=H~+9<wxgY95Rm]xLggZ-`(X}U2:Ri4h<uOawRmsJv__5@bb{jbV~3dka#a'a]!,#a+U=a>b6a3b%!/aKa/)!arwve^VyJ;:pR~DpTg3uJpS~<5pOPw;5qmPw:5pNOu!5pQJvG'!6Vyx=<qoJvA!{~Jup!%@qk7Rn/KvyD!}''[xz;>wkh'?Rh,x8gyt`w5D!&),(SgyccRgztJ@3pPB5p#d'(Y#<]mmifubw&RgoJvE&!82s^JvF&!8Rf,ADb]~;x=h'rNu]vK!,%'*0RnORh)4Rh*AqQg-vaRnNg;wHwkh'ba~4cE#Ta*x3gctyw@'!+%RnFRnD<4Rn@hFvK5RnCxWg[#`&a0Ua()`1Rm75Rg[c]%X#qi8Rg^NvdRj>BwzgZauwji7Rm6A4wgg]d1#&(*,.0a#Rm;Rm<Rm=Rm>Rm?Rm@RmARmBe%#^^^Xaea?aC/b+(,!a+a#!a/!>a&Ta<aKbD!2wphBRnk[yPw}hE|.=Br-3Dtm>6Vy~g6urRf.x,hPrNav!%'RnqRo%Ro#Nu;q[Pw;5r+JwNZtM@3r)d'#Y'Weh;xChL#`&RnmRnoKu}>%(!Rne~Bs-;2wjcussJv+'!aYSO}6@B<5?ba~8LrNvj!.%*ROwungw~ng~:9;Ri^>wtnig;wHRnixDh@|(UZ.x1h@|)!#:2<H|*xHn]#-UX'3Ro)z=iT}6ARns=Bwsn_wpnaRncw]aR(#UXa&Ua*a/=]iPd'#Y&Ro'WnXf{QRm2hNvj]nZd`'T~&1`{|`#9b]{}c:'!#Wl{>@=be}]?cl{{U#:5Abb}Jds#^YaF!a*b4a#a3aPa>&Tb!bH!*a_!Eau?/a&RjY<]gj>6Vz*;:pe~DrZg,QRj1JwNZtX@wihspcJvZ&!VyX9WmOJu|!|N2WmHJvh&!]ht~Bpbcn&T(!#RmQ<s7Nu;padH#X'`+WmJ@>RmKCARhnKup=!)&Wf+:RhqNuPpf9c!#'45pd5AwghpARn(Ls@w!%,)!RmP@Wfe<E|IJva!&WmNg8vsRmLd`*.`#Y'Xa!axRn*]hrA8Rhug5s@rXg8u!RmMd8#X'X*3@rV72smdI*#UY&RmICARho~GsgxVgd)Ta'U-Y&Xa!T#RnEWnA@Wffg1uDRi0hFvK5RnBxGnG&#`%owp)@wsf+bX}Ze-*1!a*^^^Ua|!#a.aq&Ya2!a>.a6!a:aO`aJDtL[y`@Wg#>6Vz12@wzoYRoZNuPRi!NuPRhzg=ucRi,@=b`{Yg=ucRi-ACJvB!&Sh[ebSh]ebi`wUuFRm4Jw2_[y0JvB!.<Ju(!&SoG}6Shd}6<Ju(!&SoH}6She}6Kur@._g5vHRieJvx!{L2G{Kx6gd'T#?Rh82Wi5cZ#X(g1w)Rm5dW-Y(Ta#!a)!#aYa=wnfE=su2>>bU{0j9udv:<svj8uQv-7RgHdE%#^'sq9sp=>Bb_{TJv`!&g/r|snj6v(us5d,#Y(56H}[978H}]Jw5!&g1rushJvB!+j;v{u5?zDhd}6}bj;v{u5?zDhe}6}ce*#`(^^^a[aea!=!a6a*aoXb1a.!aAbL!b>,b'aL!aV@Wf|2Wlg3[y/JwNZt^@3piPw:5pgJunZou3@rsJva&!Vy_g<v~Rm#JvG'!6Vz0=<r{Ju{%!:pj@WfsiXuJu3Rm:JvZ&!WfA~Bph@c4Z&Dtwax5rubx(#:awRk1@d,#Y&RfjRfid1#,Y(@Wfp2Wlrg5s@ryKu[@!,'=]ig9wlk?Rk>g5u-rqJvy'!@9RkQcH(T#=>Ri~@<wkj(Wj(KuZB*!&<7rw@9RkRcH(T#=>Ri}@<wkj)Wj)dg(Ta2Xa9X#`-!a*CARhg@@=I}d9x;c~#X%so=<sj>2@@=aybb}XjWv0Q~EfEj3vLv;<d,#Y(56H}`978H}_dgaPaFa'a/!#a3Y0a_a;a|!1(a7-[yE3[xt;:pJNvZrrg3uJrvJwNZt=@3pIh=rt3rxPw:5pGOu!5rpJvG'!6Vys=<rz@c4Z&Dt(ax5rtJvZ!&~BpH@wsfNg-vaRlNci*U#=<wei<F}a5@Jq.!a*JQ!%@qZ23d(#Y&RjH5]jCk!u7w&u0udARjFd/prq=tyvpaEa(a:.!a1aZ(@@=I}:9wpd%=<sX55w_h}@@=I{t=ay<aU@@=I}T=ay<2@@=I})?C9:9au@9Cb]}DP~=x-fAZ(2Wl1=ay<aU@@=I}>5@d##Y+jTv|vV~EfFj]uNpn~FRfGdgaK!Z2&!a8a-Tb({E!acTbM*!a(DtY[yYd'%Y#sl[y*hHvh>Re5x2c{Z}.j4uCvcawRiMd+#X+_x&d!},<5RkX;2Hzw@x,gavfB-!{CcF&T#Roe;RodwWbBg5urRgaKvHC*_6Vz+<4opieuew&Rmq@d]&Y)X,T#X0Rh}<BqP=4qS9:ReMg/ujReNJw0!/<Jui%!bd{kawwnemRelAxUa?a3#*.&UX(Ya+a/RhvRnQ<o}9Wmtd-#Y&RgSRmw9;Rmxay=Rmyg-vaRmuxEhSrNu,v-voC!%(aR.a(a7+1Ro1>Ro5CE{A9b]{@;5x#eO{:g;urRi+KrNA!%(Ro3>Ro79;Ri_Ku@>{;&!x%gX|{KunA_+g5QRj/g3u5Rj#g>uERj%wio/xRhS&!,!#^1U}wba{8>>@=be}qC@:D5ba{7Ku+A&!}x?ba}t>>@=be}se(aA^^^Uat!b0#{pa+awUazbGa#aLb9bgaWac'a5TbS=Br!d1#`%scp_Jvl!#rT>Re0JvX&!VyN=H{Fcm#U&:pY=ReaJv2&!]h0=]nUJvG'!6Vy|=<r%JrM_=]h2@Wlud'#)U'Wf'b]{i=]h/Jvh!&~BpWg=v]RnMx+ny#'Nu;pVwjnu=]nwxJnx,T#`&Reqwjnt=]nvieu9vrRjLLuYwP(#+!th@wih5pX~Gr'g5v/Rh4KunA'!-CARnP@wwiN:Rm_9x'cvw>!|l=<saKvAA!0&3@q}>w^e1bp#&Re2Re3BDx7gH#T|f5H|eKuZ>!%(:qNAH{]Jv6!+3B2B9=b^{X<5<B92:E{ZLvhwA(a;a%!igQuyRmad+#Y}m@3Rh5d8#X'X*:AqUAHzmaxwbh<aXRnVcF}RT#Nw&cj#U(BWnug/vsRntdka)(a3+.Zb7aYYan1!bVa@Xa}[y^@b[{G=H{+hFu73Rj&Pv#5ReQcK%T#sig1v{Rj'Ku+D#'!t]~Grm~?rkKuMB!01d5#`'Vy.ta3Dtu~Hroc8#'{^45s85AwZbP&!#Rn!wghxWn#KvEA!)&2RlA2RlBx:h|#(T,=]j09Wobz>x]z/@awRoTd+#Y(az]hFhCrm4d,#Y+jTv|Q~EfMj]uNr|~FRfOdCa!Xa9_X#@<plJvf!%b`{(9;Rgwc;.!#2x7cw#T|UDb]|T5Ju={(!=@E{&Jv)&!Ab`{'awJvf!~*>>@=be{#KuY>!+&4Ezyi[ugv&RjIdea+T)#UXa&T-T&a!Rh9auRmW=]kLg5vuRn+g3u4Rn-Ow6ARn,hHus5xNk?#UX(U~)/g8v0RkD~AwkkF?Ri.OuNBwkkA?Ri/d|a2`a*^UYa.!aBTZaTa'Xa;!(!2!-a#b2[yC>6Vyq3[xr2Wi?g1rusVh%s?DtF~<5rbJs;%!DtBfswKtCj[uvuSsEu3RgVx3o:u+wN'*Zt;@3rd~Grh~?rfg8w)Lq)qE&-a%!>bI|`jWv0vV~EfCjTv|vV~Ef@j]uNpn~FRfBcK#T']gWNu7x,k7q4ai(0!hHv8<RhmkMu9vrsBuev/RhlCJvB!,g<v{wchh~@:Rhji[vrv{wchi~@:RhkdS&a5UY#Ta!RgPwwiI5BwciI~@:Rh`x'iJvj'!5]iJPu8Bwch]~@:Rhach)U#h3rp]gLh@t|Ax,hTq3ah!-(~@:Ro0Ou!5RhXj^v(pyw8unRhVd|)`,^UYas!a?/a2Z'a^Ta{Tb7Ta(a#!a,Wf&9sZ3DtAadamov=Bqt3[xig8vsRm~>waiL2b`{QJv*_Ouv2qgj<v]v2BqfdR'X*X#Y-@3qr~Gqv~?p6hHv-]glPup5Lq+q?_%*b_{qF{n9b^{rOu4ARhpKvCD!+&~Bqp:5Dbb}nwoiKl&unuTuBv]v+ueunaXRf0=Jvh!0nKufu8v1w&w7q%w&uHrz:Rgnj5w,uxDJq/(!hNw'5ReCk0s2u3w/w'5ReFd>Za&!*UaA=<wkgsRnSJv^!%Refifw3vyRgOKu_B'!,<]gkiiu:w&Rh<=C@a^<B57@2F{[<B5@aW:=3away9A5aW=<B=C@a^<B57@2F{Ie-#`(^^^bCara.b8aza6!/bZ,!adTbnTbOb+aFaS!aAT9@Wf~2Wli3Dtl2@d,#Y&RfnRfmJwJZtN~GqyJva&!VyMg<v~Rm%iXuJu3Rm9Jv[_=]ih9wlkDRkCd1#`(@Wg>2Wls3cH#T(@<Rj*=>Ri|b~'#23s9h<~El.d'#Y&Dtxi^rzvdRl#d*#U%(o|B2s`hJwSaxRmDKv4B&!1:Rmdd5#`'Vx}to~Hq{x'f1v3(!BA5ba|bJv_&!Wfug1v]ReIdO+U/Y#&G}-8wze=Rh{g1v]ReHg/uQRf/by#)ibQwERl/cH#T(@<Rj+=>Ri{cNu+vlax-!(#a0qa9<Rii2;;bU{H;x<i=&X#Rk`<4wwi=C9H~8xAI(Y#<azRi@45wXI<B9;5bb~7dL(X#Xa(+!aL6Vy{g5QqOau:5au2@ay547EzbxOcU(UX-T#Ta#:Cbb|A?wjh/b_|SOw6ARgtihr}u7Rhy<d1#T)X1@@=I|~=ay<2@@=aybb}Sj3vLv;<d,#Y(56H}A978H}@dGpvs@uAu`vcw9*!aFa+ai%(b!aXa8.a?a[ozWey=sU2@G}Nch&U#Rf_WexKu+D#'!t:~Gr`~?r^j]uNr|~FRg*j^psurwJt|RmcKv)@&!)7Rkv~Br[@wxfO:Rl3co#U'6Rezj_q#vIuavjRltwzeyh@vr5JqD0!>aY?C9:9au@9Cb]}9cl#U*5;5<H||jbuus1ucv&Rfvg1v~d/pppzqFr^a--a~!aMat1(hFv;Wiz@@=Izoj5uuv-7Rix~Cw`fk2WlVcZ#X,k)u3vWs@u2]ktg;wEx'fBq(_2Wg/jTv|vV~EfoJv]!15x'hzqG!(P~EfU~CRl_j6v(us5x4i-#T(2WmZ?C2F|d>Kq<aj1!*jTqIsBv=Wl`~Cw`fi2WlWj`v0u*~>RlR=c>Z,k#u3vWs@u2]kr<c1Z+jTqIsBv=Wla~Cw`fm2WlXdmb3!a{(arZa`bkTa%TbQTa-a9+c'!aM!/[yL=Bqug.w'RifhFvyDRj.g>vgwyk^9]k^Jv3_@WfbAARkhJw2_[x|JvB_wkoIRoKwkoJRoLd'(Y#<]gm=<9<H|yd'%_X#skDtb3awwqkgNulRkgdB#^',9:p'hJwSaxRmEBwVb8@4=H|qLu+w50&!)@3qs~?pU>Awwn;;Rn=c:Z'ARn<=<qwKvC@!/&~BqqJv6!&]eVb^z^xRge'/a%+^`#Sge}6<4Rn3=]n0Pw2>Rn8Jw0!&>Rn:>Rn6cY#a7+!a&=<wkaNw~h3z_c5Z{=wjh#=]nLKv^D!&)Vyz=bW|swYb<WetcG#T(2wxa@qVx@gD#Y&b^|V5JwG&!5bb|pg/w&RgD@x=kHs=uAvn!a%%/'+RmSRh694Ro`g-vaRmRhHv-]mlxCcS#`&ba~.5cD#Ta)P~=d,#Y(56H{>978H{Dd_#{2^Y%_+qbbb{6g3sERhsbU{?dfa.,`a(Xa<!aiX#(55RiG54RiHcI#T'WiU3RiVNvdwtfcRlKNvdd,#Y&RlHRlExQgf.1*^T'X#Sgf}6Wn4=]hfPrk>Rn7Jw0!&>Rn5>Rn9Lunw?&a2!,5<oq@@wqfdRlJj5Q~=d,#Y(~ARfcOuN]fdDKw;ay(}i!547E}j?cI#T(@5bV}iCbV}hdv(^^Tb?a40,b##Tbo!a*bR!a<b|a/!aKai!aU[yK=]o^g:v>ReGJwPZtK<7Rh+h<~El,Pv#5ReR@awwxjCg,ulRjDJv6&!]j!z?aQeeg>w=Sh<eeJw;!&axEzOg,Qosc!#*:wkeJ]eJ>x'h-u(!%Ro.w~h.zPdNZ(X,Ya![x{;9ReY;wkgxRiF:x?ap#Y&RmUg<s2Rkod]+UY0TZ'!a&A9sw<=bczLNvuw{gqzNhJwSaxRmCKuLay!#&s_Rf-55b^{uJvZa!!c%#(55Ri654wmiu5RiuawLu,vp!+}^%b_}Y9;wkgxba}o>A9:=b^}zKuh=a''!3awRk3c*'!#aHRk6c+Z&Rk5Rk4Jv)&!awRjSawd9*`#0?C2@EzMj8u<uJ5RmbjQrquJu3x,k>uq@_+=ayb^|W~ARkEOuN]k@7dhzV^X/X&a-#zRzSb`zXcJzTT#2WkVKvDBzW!%FzY9;5bbzWjQrquJu3Jw3%!b`zU=ayb^zQd:#X(T-a!6Vyywxh}=b]{Jg=u1RiAdGp~qHtzv!w(wA+a+a;<!aJaYai'anasb(=azRmV:Cbb{MLq2vb!%')RjuRjrRjtRjqx3jnqCw3!%')Rk(Rk+Rk&Rk)Lq2vb!%')Rj{RjxRjzRjwLq2vb!%')RjsRjpRjfRjex3jcqCw3!%')Rk'Rk*RjkRjl9<CbbzfOu4ARhxLq2vb!%')RjyRjvRjhRjgx=joq*uKvb!%')+-Rk.Rk%Rj~Rk-Rk#Rj}x=jdq*uKvb!%')+-Rk,Rk!Rj|RjmRjjRjidAq&qKs@uAv8Aa.'*-a@a&0!aM@a5[y73Dsy3Ds|3Dt):wxgI2sHJwJZt.~Gqxwsf0ikrzt}Rl0Jvy_[xj~HqzKv_A|D!&WfP8axRoVcf,U#k(v]v+ueunaXRf1Ju}'!g8u#Ri=jQw!sCunLprq>!,')~<5qeGzq9F{W=c##%s5au:5aU3CBE|;d4#X(D!a&6Vygx(b;#(=]ed?C2F{N<capoq2r[a&!aPa9,'Pw;5s:@@=I|,55w_h|@@=IzcP~=x'fCqB_2Wl2>aU@@=I|1OuNBc1Z+jTqIsBv=Wlc~Cw`fl2WlZ~AcTa%!Z+jTqIsBv=Wlb~Cw`fh2WlYk+uNqJsBv=WlSg,u3dca3#UXaMYa)TaB-=cM|7T#<bI}l5@B932:aV2G{BOuNBJq:|M!5Ezt=<B=C@a^<B57@2F{v>cB{/T#=ay<bI{3Jv6!a.6BKq0ah&+!5E}HP~Ef{978BaU@@=Iza<7d#.Y#978BaU@@=IzH~AJq0!(@@=IzG978BaU@@=IzFe,aU*Y&^^^bvJb,b:bFad!a,c2Ta>aL.bo6!a#CbTa'T#Re{2Wlh2@G{yg6t~Ro_NvdRfticuRQRllJv3&!x&c|zs@Jw3!%RflwpfkRlpKuL;%(!Re<@G|C2GzdhIvuBwgjAg-u0RjAKQB%!(GzZ@G|5NuuRl7d='T+Y#Vy[g<v~Rm!==G|>JvA!)@wma=]m1ifuaw&RmnLs@vT'!|/+[y,g:v>ReTJw1!#qX=x!eC{bLu+wT&)ZtZauq_~Graci&U#F|89:r_Lupvq!.)&2RlG8RfaC=x!eF{_h?rpWlmd&'!#X|&]k::xJey#`'T|+<E|&2@H|%dE#(^,g;u.RiEg6vjRiC9xCkA{O|zY#g=ucRmXKs0@!&*@G|m@awRknJuh!,3d(}gY}eJvj!%Rm):Jw3!%Rm+Rm-Ls0w(&!a(a#@b[|6cZ#X'7RkxWgAOu4ARn'dH'U#Y*Vz-Wm'CARm}d]*#a%^a*T'aK!a<9bV{PC=p*Jw4!&SgxcbB5r]idw(wBRmF7xFkt#&`(Rm/Rm8E|!JuY_9:Rl5=wrgr2:bbxd@xXfB(a*#T+!.X0X1Ta/a'T&RlDRfL>RlyARl9b[z[>RfZ:RlL:RfRwlg/ARl;9;RlxKv,A/!%7s69<74=BA5ba{-8Bde#`a<XaKYa1,a'P~=wxfB2bZ}}?C972@@=I}r8@55B9;5bb}G978B2@@=aybb}3j3vLv;<Jw3&!>Rfk=ayb^}4~Ad1#`*@@=aybb{w2@>==<bbz]dx+UY#^UaF!a9!bB'Ya1.!ajXa#%olRhD[y=3Dt#Ov5BrHKuMB%!(Rf^Wep~HrJwkiQjKr|~FRg)Ku+D#'!t5~GrF~?rDdV)UY,Z/_7RkuG{<~BrBg,rlsO:235B@bX}|d?a1!#`(6Vyn5@d##Y+jTv|vV~EfIj]uNpn~FRfH7Lq2vb1!a9-978BaU@@=Iz9978BbU}#~AJq0!(@@=Iz8978BaU@@=Iz7~AJQ|}!978BbU}!JvkaK!AdUa21-U#`a+(g/vsRn~Ou!5RPj:rmu9WhOjXuvvNr}:RhAj^v(pyw8unRn[kPr}p|u7vwv]RiSBd;pppzq@qHQa?(b.!a.a`@.|xa(hFv;Wiyj5uuv-7Riw~Cw`fg2WlU978BbU|wOuNBJqG!(P~EfD~CRlQcZ#X,k)u3vWs@u2]ksg;wEx'f@q1_2Wg.j]uNpn~FRfqJv]!15x'h{qG!(@@=IzK~CRl^j6v(us5x4i,#T(2WmY?C2F{1>Kq<aj1!*jTqIsBv=Wld~Cw`fj2Wl[j`v0u*~>RlT=c>Z,k#u3vWs@u2]kq<c1Z+jTqIsBv=Wle~Cw`fn2Wl]dn1#c(a(b^a2!b/bAT(bj!aDa7bu,a_a{c0!2T0g:v>ReD2@G{42@G{5~DpM~<5rc=Bx6i>{RT#RnI@zCx]y]z:2Jv[!zr5Awyk]9]k]dD(Y+X#6Vz.g=wKtgwhaCwgmTWj2Lu,w%_+/[y-B;b^xeg3u3Rj-2@bX{*KrJ<!+'@Wg(g?QRlC@Jv`!%b[zIwsfII}8JQ_@w|kW|=Jv(%!AqcOuNBJvEzh!bYzjLs@wP#(0!oy@>RkdJwMZtc3Dtd@BcG#T'9bWxg2@2Fznd*#Y+;2x'c}w<zizixNgwa#Z'U+!/!a'!a+w~g~z6wcn{Rn}wcnzRn|5Rh%=]nJg5vuRmvNvdRlvcprJu}w*az*a#!%.a.'Bot9qT]kj@Wg'ay2Gzv@Jv`!%b[zEwsfHI}1;ck#Ux`<Cbbx_Lu+w!a&0*!wko*wwo,So,}6Juqxf!E}PigQuyRm`d3(`#8>Rn%:A5B;bZ~%KvhCa!a2!x>k7#Uxb@b{#xaRk7Jw0!)>wwhlShl}6>wwhmShm}6CJvB!.x'hhvj{!!5Bwkhhbaz}x'hivjz~!5Bwkhibaz|xEhTrNu,v-vpD!a%&/)a3a.,%Ro2t[CE{)@3re9b]{%wjo09:rgc:Z&Ro6=<riifuaw&RmoKrNA!%(Ro4>Ro89;Ri`dSaL'UYzxZb)7Rka3xRhT&!,!#^1U}vbaz{>>@=be}yC@:D5bazzKu+A&!}{?ba}y>>@=be}wxBh[t`u~vJvr!%a!a()a,a0a4RoC=]o;Ju(!%RoGRhdwjh`=]oAg>w#Ro?g5vuRo=NvdRl|Ku]C.!&;RoEJvB!%RoORoMBx'h[v+_?w~h`}~5?w~hd~!xKh]oiptu-utv.vp!#%&a30a@a'a+(a/aOp(o~p!RoDJu(!%RoHRhewjha=]oBNvdRl}g>w#Ro@g5vuRo>c[#X']o<CauRoRAd-#Y':RkpauRoQKu]C.!&;RoFJvB!%RoNRoPBx'h]v+_?w~ha}t5?w~he}ue!/UbhYacXaW^Tc&a;b:a-c/#b&aja1(!cL+!bKbt!bmcRc9aIc?8[yW3Dtt94Rg`Jv}!&SiRMzBhEebShEMNuPRe>x7gL#TzuwjirRipc<Z&>on;>z=h-MSh.Mwqczx'a7vj&!>Re4@=ResJt__NuPRi*NuPRi)j]uNr|~FRfzKrJ>_+@Wfy@Wf]2WocKrJ<!+'@Wg%g/QRl@@Jv`!&awRl<wsfFIzgLu(w*!.*&ShBMwvhIRhI9;RhNx1hK'!#Sn]Mx1hK~0!#:2<H~7cNu+w7D*'1ZtW>Rn1~?rOc:Z&Rn2=<rQ<7wjh&=BSnLMc]#X(6Vz)w[b=a!U#9wzgMc3#&(RgMRitRis<x,gKt`ax!&+SioM=BSilMc3#&(RgKRinRimKurB,!&SiQMzBhDebShDM6BJQ!(P~Efx978B2@@=I}WLrJw!!,a*&@G}O@9wkibRid@@x'fKwC!&SlDMSfLMjUv~Q~EfKKv3@a+!(hFv-]mpx/hYZ(C5RiWz<o/MwkhY?So/M@x,gbvfB*&!SgEM:SoeeehFu3:Rgbda(,^TZa)X/7Sg[eb:2RgI~BrMC@wgkc:wwkcRerx3h(uUvK!&*,SnOM4Sh*MArRg;wHRh(x=h;rJvPwI!a4',a'0@Wg&=BSh/Mg>w=Rh=g3w*wwgGRgGcW(X#;Sg}M2Gzk@Jv`!&awRl=wsfGIz`dKZ*T'Y-:RhR7RhQg5u-p`j6v(us5d,#Y+~Awkia?RicOuNBwkibba}Ld6p~tyu_vbAa'a+!a/'a3aEa8a!>Sh,ebJv{!&Sh@ebSaReb9;SgwebNuPRi(NvdRl)NuPRi'hHu^<Rm^Jvv_@Wl(g;u1Si/ebKu'B&!*Sh?eb@Wl'z@aPeb95Si.ebcpputyvjB)!,&a+0a%ShAMWeK@G}C@WfJ9;RhMwvhH9w{ia}ix,hJvRA1(!zAn[MRhHx1hJ~*!#hFv(BSn[MBJQ!(@@=I~'978B2@@=I}2db.Ua<'X}+T#a0XaG2G}E;wkg|wuh!Rh!x,hZu,@)!&So0MVy)C5RiXACJvB!&5RiY5RiZg8w)cG}*T#2@bU}=KsA>(!a.3wkhZba~(x,h^u(A!&(SoCMRhb5Bz=h[eb?w~hb~6x,h_u(A!&(SoDMRhc5Bz=h]eb?w~hc~6e)aA1T#T,^^^c-bMb&blcPaP(a/!0!bA=b5c@a(!bfbrc#2afwmhARnjwchORnp2Wlf3DtsNvdRl-2@wpa<]m0bx(#:awRk2@Jw3!%RfhwpfgRlnKQB%!(G{V@G|'NuuRl6d='T+Y#VyUg<v~Rl~==G|<Jv+'!aYShC}6@B<5?ba~8@Jw3'!g2QRljhLrpWlOd+#Y'g.w'rIg>w*wgj@g-u0Rj@Lu+wT&)ZtUauq]~GrGci&U#F|39:rELrNvj!.%*RhCwunfw~nf~:9;Ri]>wtnhg;wHRnhx3hDs@v~!/+'@Wfr@9RkSNu&Rlo=@<5GzoKs0@_+@Wl+@awRkmJuh!-3d(}pY#qWJvj!%Rm(:Jw3!%Rm,Rm*de&!1U-U#`)Re;@G|.@9Ri82@wjfvRlq=@<5GzpLvOvr!).&2RlF8Rf`C=x!eE{.Jw3_g2QRlkhLrpWlPde(!#U{s,UXa*Ta'[y'g:v>ReS;x0PZ&RnlRnn~HrKJw1}f!=x!eB|2w]aP(#Xa&a*Ta.Ua2a7=]iOd'#Y&Ro&WnWg;u.RiDg6vjRiBNvdRlzhNvj]nYJuW_2Wm3x)kFze{9d])!a.!,Y01!#&aC!a3RndC=ox~BrC@2b^{pg,rlse7x'ksuq!%Rm.E{xidw(wBRmGx9o+)X#wwo-So-}69:Rl4@xSf@a#XZ'X)X,Ta(/ARl8b[xc>RfY:RlI:RfQwlg.ARl:9;Rlwdn'#^XafaQa1X1TaHTa)@b[{zcZ#X'7RkwWg@Ou4ARn&x)kG#{,g7u/RkGdH'U#Y*Vz'Wm&CARm|bx#(A]gUbUzJj9Q~=d,#Y(56H}l978H{U7d,0#U*2>ABb_xZ978BbU{e~AJQ{g!978BbU{hxMh?ad{oUYZ.x1h?{l!#:2<H{mx3n[t{vl!,&a%3Ro(z=iS}6ARnr=Bwsn^wvn`Rnbd`*T}B0!#^X'BG{c9b]{a>>@=be}F?JvS!&BG{d7BG}(Bde#`a1X,Ya@!a'P~=wxf@2bZ}I56B2@@=aybb}08@55B9;5bb}<j3vLv;<Jw3&!>Rfg=ayb^}&OuNBKuLA!)a!P~=x#fD{f2@>==<bbzl?C972@@=Ix^d6rSu,v7w*C(0a)a6#B+a%!sQ[y?3Dt%3[xn~<5rLOu!5p@Ku+D#'!t7~GrP~?rNKvlaya7'!h+v-5qMg=t|cd,U#5AAaa5Abb{S@52B5@a[@52B5Gx[iXueu;d<#`a(!/549C;ag>23ExY5@Dah89b^~689Jv)!~2b[~1Lv'w(%*!a#bX|aPrmawRe]keu7uhv-q6rxu,q`xTo]/a5aU!bNaDXbi!b-!ao!b<bwA!#5@B932:aV2G|:d-)Y#hJrL>RhG<7@C5<H|_=Cau:5aj5@B932:bJ|ng>vIbs)#?C2F|9jPv0w.vISh-MKvUaz(.!9ABbb|[5;5<H|Eg>unwfh;9:4E|YjQsBt|vjx'hYq3!(?C2F|J:2<BaY?C2F|GOu!5x,g|p{ah!-(?C2F|c9:4E|OjXuvvNr}:Rh&i[w*t|cd+U#jJvsu)vsSn~Mkfrmu9p}u7vwv]So!McW#Xa!ax5@A5aY:5;5<H|>kJv~vYrquJu3x4ib#T)2@SmZM?C2F|Bj:rmu9@xPhI(a*a#U#`a3-5Abb|L~@:RhK9:4E|0@52B5G|#C::aY?C2F|-:2<BaY?C2F|.5Jvk!a)javYrquJu3x4ia#T)2@SmYM?C2F|HAxPhH(!a#U#`a*-5Abb|4~@:RhJ9:4E|R@52B5G|F:2<BaY?C2F|Sc^#Xa2j=Qq5CJvB!-g<v{z;hhM?C2F|Zi[vrv{z;hiM?C2F|XKsA>!a)-g<v{z;h[eb?C2F|]i[vrv{z;h]eb?C2F|^iZu.vix,hZq3ah!.(?C2F|QOu!5ShXM:2<BaY?C2F|P", 13494, 2713, 49, 25, 61), Ka = /* #__PURE__ */ new Uint16Array([
	512,
	26465,
	29036,
	7,
	0,
	2,
	4,
	116,
	24638,
	116,
	24636,
	8693,
	29807,
	24610,
	621,
	1,
	0,
	0,
	3,
	112,
	24614,
	111,
	115,
	24615
]), qa;
(function(e) {
	e[e.VALUE_LENGTH = 49152] = "VALUE_LENGTH", e[e.FLAG13 = 8192] = "FLAG13", e[e.BRANCH_LENGTH = 8064] = "BRANCH_LENGTH", e[e.JUMP_TABLE = 127] = "JUMP_TABLE", e[e.VALUE_MASK = 8191] = "VALUE_MASK";
})(qa ||= {});
//#endregion
//#region ../../node_modules/htmlparser2/node_modules/entities/dist/decode.js
var Ja;
(function(e) {
	e[e.AMP = 38] = "AMP", e[e.NUM = 35] = "NUM", e[e.SEMI = 59] = "SEMI", e[e.EQUALS = 61] = "EQUALS", e[e.ZERO = 48] = "ZERO", e[e.NINE = 57] = "NINE", e[e.LOWER_A = 97] = "LOWER_A", e[e.LOWER_X = 120] = "LOWER_X";
})(Ja ||= {});
var Ya = 32;
function Xa(e) {
	return e - Ja.ZERO >>> 0 <= 9;
}
function Za(e) {
	return (e | Ya) - Ja.LOWER_A >>> 0 <= 5;
}
function Qa(e) {
	return (e | Ya) - Ja.LOWER_A >>> 0 <= 25;
}
function $a(e) {
	return e === Ja.EQUALS || Qa(e) || Xa(e);
}
var eo;
(function(e) {
	e[e.EntityStart = 0] = "EntityStart", e[e.NumericStart = 1] = "NumericStart", e[e.NumericDecimal = 2] = "NumericDecimal", e[e.NumericHex = 3] = "NumericHex", e[e.NamedEntity = 4] = "NamedEntity";
})(eo ||= {});
var to;
(function(e) {
	e[e.Legacy = 0] = "Legacy", e[e.Strict = 1] = "Strict", e[e.Attribute = 2] = "Attribute";
})(to ||= {});
var no = class {
	decodeTree;
	emitCodePoint;
	errors;
	state = eo.EntityStart;
	consumed = 1;
	result = 0;
	treeIndex = 0;
	excess = 1;
	decodeMode = to.Strict;
	runConsumed = 0;
	constructor(e, t, n) {
		this.decodeTree = e, this.emitCodePoint = t, this.errors = n;
	}
	startEntity(e) {
		this.decodeMode = e, this.state = eo.EntityStart, this.result = 0, this.treeIndex = 0, this.excess = 1, this.consumed = 1, this.runConsumed = 0;
	}
	write(e, t) {
		switch (this.state) {
			case eo.EntityStart: return e.charCodeAt(t) === Ja.NUM ? (this.state = eo.NumericStart, this.consumed += 1, this.stateNumericStart(e, t + 1)) : (this.state = eo.NamedEntity, this.stateNamedEntity(e, t));
			case eo.NumericStart: return this.stateNumericStart(e, t);
			case eo.NumericDecimal: return this.stateNumericDecimal(e, t);
			case eo.NumericHex: return this.stateNumericHex(e, t);
			default: return this.stateNamedEntity(e, t);
		}
	}
	stateNumericStart(e, t) {
		return t >= e.length ? -1 : (e.charCodeAt(t) | Ya) === Ja.LOWER_X ? (this.state = eo.NumericHex, this.consumed += 1, this.stateNumericHex(e, t + 1)) : (this.state = eo.NumericDecimal, this.stateNumericDecimal(e, t));
	}
	stateNumericHex(e, t) {
		let n = e.length, { result: r } = this, { consumed: i } = this;
		for (; t < n;) {
			let n = e.charCodeAt(t);
			if (Xa(n) || Za(n)) {
				let e = n <= Ja.NINE ? n - Ja.ZERO : (n | Ya) - Ja.LOWER_A + 10;
				r = r * 16 + e, i += 1, t += 1;
			} else return this.result = r, this.consumed = i, this.emitNumericEntity(n, 3);
		}
		return this.result = r, this.consumed = i, -1;
	}
	stateNumericDecimal(e, t) {
		let n = e.length, { result: r } = this, { consumed: i } = this;
		for (; t < n;) {
			let n = e.charCodeAt(t) - Ja.ZERO;
			if (n >>> 0 > 9) return this.result = r, this.consumed = i, this.emitNumericEntity(n + Ja.ZERO, 2);
			r = r * 10 + n, i += 1, t += 1;
		}
		return this.result = r, this.consumed = i, -1;
	}
	emitNumericEntity(e, t) {
		if (this.consumed <= t) return this.errors?.absenceOfDigitsInNumericCharacterReference(this.consumed), 0;
		if (e === Ja.SEMI) this.consumed += 1;
		else if (this.decodeMode === to.Strict) return 0;
		return this.emitCodePoint((this.decodeTree === Ka ? Ha : Va)(this.result), this.consumed), this.errors && (e !== Ja.SEMI && this.errors.missingSemicolonAfterCharacterReference(), this.errors.validateNumericCharacterReference(this.result)), this.consumed;
	}
	flushAndEmitLegacyOrReject(e, t, n, r) {
		return this.consumed = e, this.excess = t, this.result === 0 || this.decodeMode === to.Attribute && (r === 0 || t > 1 || $a(n)) ? 0 : this.emitNotTerminatedNamedEntity();
	}
	stateNamedEntity(e, t) {
		let { decodeTree: n } = this, r = e.length, i = this.decodeMode === to.Strict, { treeIndex: a } = this, { excess: o } = this, { consumed: s } = this, c = n[a];
		for (; t < r;) {
			for (; (c & (qa.VALUE_LENGTH | qa.FLAG13)) === 0 && (c & qa.JUMP_TABLE) !== 0;) {
				let i = e.charCodeAt(t), l = c & qa.JUMP_TABLE, u = (c & qa.BRANCH_LENGTH) >> 7;
				if (u === 0) {
					if (i !== l) return this.flushAndEmitLegacyOrReject(s, o, i, 0);
					a += 1;
				} else {
					let e = i - l;
					if (e >>> 0 >= u) return this.flushAndEmitLegacyOrReject(s, o, i, 0);
					let t = n[a + 1 + e];
					if (t === 0) return this.flushAndEmitLegacyOrReject(s, o, i, 0);
					a = a + u + t & 65535;
				}
				if (c = n[a], t += 1, o += 1, t >= r) break;
			}
			if (t >= r) break;
			if ((c & (qa.VALUE_LENGTH | qa.FLAG13)) === qa.FLAG13) {
				let i = (c & qa.BRANCH_LENGTH) >> 7, { runConsumed: l } = this;
				if (l === 0) {
					let n = e.charCodeAt(t);
					if (n !== (c & qa.JUMP_TABLE)) return this.flushAndEmitLegacyOrReject(s, o, n, 0);
					t += 1, o += 1, l = 1;
				}
				for (; l < i;) {
					if (t >= r) return this.treeIndex = a, this.excess = o, this.consumed = s, this.runConsumed = l, -1;
					let i = l - 1, c = n[a + 1 + (i >> 1)] >> ((i & 1) << 3) & 255, u = e.charCodeAt(t);
					if (u !== c) return this.runConsumed = 0, this.flushAndEmitLegacyOrReject(s, o, u, 0);
					t += 1, o += 1, l += 1;
				}
				this.runConsumed = 0, a += 1 + (i >> 1), c = n[a];
				continue;
			}
			let l = c >>> 14, u = e.charCodeAt(t);
			if (l !== 0) {
				if (!i && (c & qa.FLAG13) === 0 && (this.result = a, s += o - 1, o = 1), u === Ja.SEMI) return this.emitNamedEntityData(a, l, s + o);
				if (l === 1) return this.flushAndEmitLegacyOrReject(s, o, u, l);
			}
			let d = ro(n, c, a + (l || 1), u);
			if (d < 0) return this.flushAndEmitLegacyOrReject(s, o, u, l);
			a = d, c = n[a], t += 1, o += 1;
		}
		return !i && c >>> 14 && (c & qa.FLAG13) === 0 && (this.result = a, s += o - 1, o = 1), this.treeIndex = a, this.excess = o, this.consumed = s, -1;
	}
	emitNotTerminatedNamedEntity() {
		let { result: e, decodeTree: t } = this, n = t[e] >>> 14;
		return this.emitNamedEntityData(e, n, this.consumed), this.errors?.missingSemicolonAfterCharacterReference(), this.consumed;
	}
	emitNamedEntityData(e, t, n) {
		let { decodeTree: r } = this;
		return this.emitCodePoint(t === 1 ? r[e] & qa.VALUE_MASK : r[e + 1], n), t === 3 && this.emitCodePoint(r[e + 2], n), n;
	}
	end() {
		switch (this.state) {
			case eo.NamedEntity: return this.result !== 0 && (this.decodeMode !== to.Attribute || this.result === this.treeIndex) ? this.emitNotTerminatedNamedEntity() : 0;
			case eo.NumericDecimal: return this.emitNumericEntity(0, 2);
			case eo.NumericHex: return this.emitNumericEntity(0, 3);
			case eo.NumericStart: return this.errors?.absenceOfDigitsInNumericCharacterReference(this.consumed), 0;
			default: return 0;
		}
	}
};
function ro(e, t, n, r) {
	let i = (t & qa.BRANCH_LENGTH) >> 7, a = t & qa.JUMP_TABLE;
	if (a) {
		if (i === 0) return r === a ? n : -1;
		let t = r - a;
		if (t >>> 0 >= i) return -1;
		let o = e[n + t];
		return o === 0 ? -1 : n + i + o - 1 & 65535;
	}
	if (i === 0) return -1;
	let o = i + 1 >> 1, s = n + o + i;
	for (let t = 0; t < i; t++) {
		let i = e[n + (t >> 1)] >> ((t & 1) << 3) & 255;
		if (i === r) return s + e[n + o + t] & 65535;
		if (i > r) return -1;
	}
	return -1;
}
//#endregion
//#region ../../node_modules/htmlparser2/dist/Tokenizer.js
var P;
(function(e) {
	e[e.Tab = 9] = "Tab", e[e.NewLine = 10] = "NewLine", e[e.FormFeed = 12] = "FormFeed", e[e.CarriageReturn = 13] = "CarriageReturn", e[e.Space = 32] = "Space", e[e.ExclamationMark = 33] = "ExclamationMark", e[e.Number = 35] = "Number", e[e.Amp = 38] = "Amp", e[e.SingleQuote = 39] = "SingleQuote", e[e.DoubleQuote = 34] = "DoubleQuote", e[e.Dash = 45] = "Dash", e[e.Slash = 47] = "Slash", e[e.Zero = 48] = "Zero", e[e.Nine = 57] = "Nine", e[e.Semi = 59] = "Semi", e[e.Lt = 60] = "Lt", e[e.Eq = 61] = "Eq", e[e.Gt = 62] = "Gt", e[e.Questionmark = 63] = "Questionmark", e[e.UpperA = 65] = "UpperA", e[e.LowerA = 97] = "LowerA", e[e.UpperF = 70] = "UpperF", e[e.LowerF = 102] = "LowerF", e[e.UpperZ = 90] = "UpperZ", e[e.LowerZ = 122] = "LowerZ", e[e.LowerX = 120] = "LowerX", e[e.OpeningSquareBracket = 91] = "OpeningSquareBracket";
})(P ||= {});
var F;
(function(e) {
	e[e.Text = 1] = "Text", e[e.BeforeTagName = 2] = "BeforeTagName", e[e.InTagName = 3] = "InTagName", e[e.InSelfClosingTag = 4] = "InSelfClosingTag", e[e.BeforeClosingTagName = 5] = "BeforeClosingTagName", e[e.InClosingTagName = 6] = "InClosingTagName", e[e.AfterClosingTagName = 7] = "AfterClosingTagName", e[e.BeforeAttributeName = 8] = "BeforeAttributeName", e[e.InAttributeName = 9] = "InAttributeName", e[e.AfterAttributeName = 10] = "AfterAttributeName", e[e.BeforeAttributeValue = 11] = "BeforeAttributeValue", e[e.InAttributeValueDq = 12] = "InAttributeValueDq", e[e.InAttributeValueSq = 13] = "InAttributeValueSq", e[e.InAttributeValueNq = 14] = "InAttributeValueNq", e[e.BeforeDeclaration = 15] = "BeforeDeclaration", e[e.InDeclaration = 16] = "InDeclaration", e[e.InProcessingInstruction = 17] = "InProcessingInstruction", e[e.BeforeComment = 18] = "BeforeComment", e[e.CDATASequence = 19] = "CDATASequence", e[e.DeclarationSequence = 20] = "DeclarationSequence", e[e.InSpecialComment = 21] = "InSpecialComment", e[e.InCommentLike = 22] = "InCommentLike", e[e.SpecialStartSequence = 23] = "SpecialStartSequence", e[e.InSpecialTag = 24] = "InSpecialTag", e[e.InPlainText = 25] = "InPlainText", e[e.InEntity = 26] = "InEntity";
})(F ||= {});
function io(e) {
	return e === P.Space || e === P.NewLine || e === P.Tab || e === P.FormFeed || e === P.CarriageReturn;
}
function ao(e) {
	return e === P.Slash || e === P.Gt || io(e);
}
function oo(e) {
	return e >= P.LowerA && e <= P.LowerZ || e >= P.UpperA && e <= P.UpperZ;
}
var so;
(function(e) {
	e[e.NoValue = 0] = "NoValue", e[e.Unquoted = 1] = "Unquoted", e[e.Single = 2] = "Single", e[e.Double = 3] = "Double";
})(so ||= {});
var I = {
	Empty: /* @__PURE__ */ new Uint8Array(),
	Cdata: new Uint8Array([
		67,
		68,
		65,
		84,
		65,
		91
	]),
	CdataEnd: new Uint8Array([
		93,
		93,
		62
	]),
	CommentEnd: new Uint8Array([
		45,
		45,
		33,
		62
	]),
	Doctype: new Uint8Array([
		100,
		111,
		99,
		116,
		121,
		112,
		101
	]),
	IframeEnd: new Uint8Array([
		60,
		47,
		105,
		102,
		114,
		97,
		109,
		101
	]),
	NoembedEnd: new Uint8Array([
		60,
		47,
		110,
		111,
		101,
		109,
		98,
		101,
		100
	]),
	NoframesEnd: new Uint8Array([
		60,
		47,
		110,
		111,
		102,
		114,
		97,
		109,
		101,
		115
	]),
	Plaintext: new Uint8Array([
		60,
		47,
		112,
		108,
		97,
		105,
		110,
		116,
		101,
		120,
		116
	]),
	ScriptEnd: new Uint8Array([
		60,
		47,
		115,
		99,
		114,
		105,
		112,
		116
	]),
	StyleEnd: new Uint8Array([
		60,
		47,
		115,
		116,
		121,
		108,
		101
	]),
	TitleEnd: new Uint8Array([
		60,
		47,
		116,
		105,
		116,
		108,
		101
	]),
	TextareaEnd: new Uint8Array([
		60,
		47,
		116,
		101,
		120,
		116,
		97,
		114,
		101,
		97
	]),
	XmpEnd: new Uint8Array([
		60,
		47,
		120,
		109,
		112
	])
}, co = /* @__PURE__ */ new Map([
	[I.IframeEnd[2], I.IframeEnd],
	[I.NoembedEnd[2], I.NoembedEnd],
	[I.Plaintext[2], I.Plaintext],
	[I.ScriptEnd[2], I.ScriptEnd],
	[I.TitleEnd[2], I.TitleEnd],
	[I.XmpEnd[2], I.XmpEnd]
]), lo = class {
	cbs;
	state = F.Text;
	buffer = "";
	sectionStart = 0;
	index = 0;
	entityStart = 0;
	baseState = F.Text;
	isSpecial = !1;
	running = !0;
	offset = 0;
	xmlMode;
	decodeEntities;
	recognizeSelfClosing;
	entityDecoder;
	constructor({ xmlMode: e = !1, decodeEntities: t = !0, recognizeSelfClosing: n = e }, r) {
		this.cbs = r, this.xmlMode = e, this.decodeEntities = t, this.recognizeSelfClosing = n, this.entityDecoder = new no(e ? Ka : Ga, (e, t) => this.emitCodePoint(e, t));
	}
	reset() {
		this.state = F.Text, this.buffer = "", this.sectionStart = 0, this.index = 0, this.baseState = F.Text, this.isSpecial = !1, this.currentSequence = I.Empty, this.sequenceIndex = 0, this.running = !0, this.offset = 0;
	}
	write(e) {
		this.offset += this.buffer.length, this.buffer = e, this.parse();
	}
	end() {
		this.running && this.finish();
	}
	pause() {
		this.running = !1;
	}
	resume() {
		this.running = !0, this.index < this.buffer.length + this.offset && this.parse();
	}
	stateText(e) {
		e === P.Lt || !this.decodeEntities && this.fastForwardTo(P.Lt) ? (this.index > this.sectionStart && this.cbs.ontext(this.sectionStart, this.index), this.state = F.BeforeTagName, this.sectionStart = this.index) : this.decodeEntities && e === P.Amp && this.startEntity();
	}
	currentSequence = I.Empty;
	sequenceIndex = 0;
	enterTagBody() {
		this.currentSequence === I.Plaintext ? (this.currentSequence = I.Empty, this.state = F.InPlainText) : this.isSpecial ? (this.state = F.InSpecialTag, this.sequenceIndex = 0) : this.state = F.Text;
	}
	stateSpecialStartSequence(e) {
		let t = e | 32;
		if (this.sequenceIndex < this.currentSequence.length) {
			if (t === this.currentSequence[this.sequenceIndex]) {
				this.sequenceIndex++;
				return;
			}
			if (this.sequenceIndex === 3) {
				if (this.currentSequence === I.ScriptEnd && t === I.StyleEnd[3]) {
					this.currentSequence = I.StyleEnd, this.sequenceIndex = 4;
					return;
				}
				if (this.currentSequence === I.TitleEnd && t === I.TextareaEnd[3]) {
					this.currentSequence = I.TextareaEnd, this.sequenceIndex = 4;
					return;
				}
			} else if (this.sequenceIndex === 4 && this.currentSequence === I.NoembedEnd && t === I.NoframesEnd[4]) {
				this.currentSequence = I.NoframesEnd, this.sequenceIndex = 5;
				return;
			}
		} else if (ao(e)) {
			this.sequenceIndex = 0, this.state = F.InTagName, this.stateInTagName(e);
			return;
		}
		this.isSpecial = !1, this.currentSequence = I.Empty, this.sequenceIndex = 0, this.state = F.InTagName, this.stateInTagName(e);
	}
	stateCDATASequence(e) {
		e === I.Cdata[this.sequenceIndex] ? ++this.sequenceIndex === I.Cdata.length && (this.state = F.InCommentLike, this.currentSequence = I.CdataEnd, this.sequenceIndex = 0, this.sectionStart = this.index + 1) : (this.sequenceIndex = 0, this.xmlMode ? (this.state = F.InDeclaration, this.stateInDeclaration(e)) : (this.state = F.InSpecialComment, this.stateInSpecialComment(e)));
	}
	fastForwardTo(e) {
		for (; ++this.index < this.buffer.length + this.offset;) if (this.buffer.charCodeAt(this.index - this.offset) === e) return !0;
		return this.index = this.buffer.length + this.offset - 1, !1;
	}
	emitComment(e) {
		this.cbs.oncomment(this.sectionStart, this.index, e), this.sequenceIndex = 0, this.sectionStart = this.index + 1, this.state = F.Text;
	}
	stateInCommentLike(e) {
		!this.xmlMode && this.currentSequence === I.CommentEnd && this.sequenceIndex <= 1 && this.index === this.sectionStart + this.sequenceIndex && e === P.Gt ? this.emitComment(this.sequenceIndex) : this.currentSequence === I.CommentEnd && this.sequenceIndex === 2 && e === P.Gt ? this.emitComment(2) : this.currentSequence === I.CommentEnd && this.sequenceIndex === this.currentSequence.length - 1 && e !== P.Gt ? this.sequenceIndex = Number(e === P.Dash) : e === this.currentSequence[this.sequenceIndex] ? ++this.sequenceIndex === this.currentSequence.length && (this.currentSequence === I.CdataEnd ? this.cbs.oncdata(this.sectionStart, this.index, 2) : this.cbs.oncomment(this.sectionStart, this.index, 3), this.sequenceIndex = 0, this.sectionStart = this.index + 1, this.state = F.Text) : this.sequenceIndex === 0 ? this.fastForwardTo(this.currentSequence[0]) && (this.sequenceIndex = 1) : e !== this.currentSequence[this.sequenceIndex - 1] && (this.sequenceIndex = 0);
	}
	isTagStartChar(e) {
		return this.xmlMode ? !ao(e) : oo(e);
	}
	stateInSpecialTag(e) {
		if (this.sequenceIndex === this.currentSequence.length) {
			if (ao(e)) {
				let t = this.index - this.currentSequence.length;
				if (this.sectionStart < t) {
					let e = this.index;
					this.index = t, this.cbs.ontext(this.sectionStart, t), this.index = e;
				}
				this.isSpecial = !1, this.sectionStart = t + 2, this.stateInClosingTagName(e);
				return;
			}
			this.sequenceIndex = 0;
		}
		(e | 32) === this.currentSequence[this.sequenceIndex] ? this.sequenceIndex += 1 : this.sequenceIndex === 0 ? this.currentSequence === I.TitleEnd || this.currentSequence === I.TextareaEnd ? this.decodeEntities && e === P.Amp && this.startEntity() : this.fastForwardTo(P.Lt) && (this.sequenceIndex = 1) : this.sequenceIndex = Number(e === P.Lt);
	}
	stateBeforeTagName(e) {
		if (e === P.ExclamationMark) this.state = F.BeforeDeclaration, this.sectionStart = this.index + 1;
		else if (e === P.Questionmark) this.xmlMode ? (this.state = F.InProcessingInstruction, this.sequenceIndex = 0, this.sectionStart = this.index + 1) : (this.state = F.InSpecialComment, this.sectionStart = this.index);
		else if (this.isTagStartChar(e)) {
			this.sectionStart = this.index;
			let t = this.xmlMode || this.cbs.isInForeignContext?.() ? void 0 : co.get(e | 32);
			t === void 0 ? this.state = F.InTagName : (this.isSpecial = !0, this.currentSequence = t, this.sequenceIndex = 3, this.state = F.SpecialStartSequence);
		} else e === P.Slash ? this.state = F.BeforeClosingTagName : (this.state = F.Text, this.stateText(e));
	}
	stateInTagName(e) {
		ao(e) && (this.cbs.onopentagname(this.sectionStart, this.index), this.sectionStart = -1, this.state = F.BeforeAttributeName, this.stateBeforeAttributeName(e));
	}
	stateBeforeClosingTagName(e) {
		io(e) ? this.xmlMode || (this.state = F.InSpecialComment, this.sectionStart = this.index) : e === P.Gt ? (this.state = F.Text, this.xmlMode || (this.sectionStart = this.index + 1)) : (this.state = this.isTagStartChar(e) ? F.InClosingTagName : F.InSpecialComment, this.sectionStart = this.index);
	}
	stateInClosingTagName(e) {
		ao(e) && (this.cbs.onclosetag(this.sectionStart, this.index), this.sectionStart = -1, this.state = F.AfterClosingTagName, this.stateAfterClosingTagName(e));
	}
	stateAfterClosingTagName(e) {
		(e === P.Gt || this.fastForwardTo(P.Gt)) && (this.state = F.Text, this.sectionStart = this.index + 1);
	}
	stateBeforeAttributeName(e) {
		e === P.Gt ? (this.cbs.onopentagend(this.index), this.enterTagBody(), this.sectionStart = this.index + 1) : e === P.Slash ? this.state = F.InSelfClosingTag : io(e) || (this.state = F.InAttributeName, this.sectionStart = this.index);
	}
	stateInSelfClosingTag(e) {
		if (e === P.Gt) {
			if (this.cbs.onselfclosingtag(this.index), this.sectionStart = this.index + 1, !this.recognizeSelfClosing) {
				this.enterTagBody();
				return;
			}
			this.state = F.Text, this.isSpecial = !1, this.currentSequence = I.Empty;
		} else io(e) || (this.state = F.BeforeAttributeName, this.stateBeforeAttributeName(e));
	}
	stateInAttributeName(e) {
		(e === P.Eq || ao(e)) && (this.cbs.onattribname(this.sectionStart, this.index), this.sectionStart = this.index, this.state = F.AfterAttributeName, this.stateAfterAttributeName(e));
	}
	stateAfterAttributeName(e) {
		e === P.Eq ? this.state = F.BeforeAttributeValue : e === P.Slash || e === P.Gt ? (this.cbs.onattribend(so.NoValue, this.sectionStart), this.sectionStart = -1, this.state = F.BeforeAttributeName, this.stateBeforeAttributeName(e)) : io(e) || (this.cbs.onattribend(so.NoValue, this.sectionStart), this.state = F.InAttributeName, this.sectionStart = this.index);
	}
	stateBeforeAttributeValue(e) {
		e === P.DoubleQuote ? (this.state = F.InAttributeValueDq, this.sectionStart = this.index + 1) : e === P.SingleQuote ? (this.state = F.InAttributeValueSq, this.sectionStart = this.index + 1) : io(e) || (this.sectionStart = this.index, this.state = F.InAttributeValueNq, this.stateInAttributeValueNoQuotes(e));
	}
	handleInAttributeValue(e, t) {
		e === t || !this.decodeEntities && this.fastForwardTo(t) ? (this.cbs.onattribdata(this.sectionStart, this.index), this.sectionStart = -1, this.cbs.onattribend(t === P.DoubleQuote ? so.Double : so.Single, this.index + 1), this.state = F.BeforeAttributeName) : this.decodeEntities && e === P.Amp && this.startEntity();
	}
	stateInAttributeValueDoubleQuotes(e) {
		this.handleInAttributeValue(e, P.DoubleQuote);
	}
	stateInAttributeValueSingleQuotes(e) {
		this.handleInAttributeValue(e, P.SingleQuote);
	}
	stateInAttributeValueNoQuotes(e) {
		io(e) || e === P.Gt ? (this.cbs.onattribdata(this.sectionStart, this.index), this.sectionStart = -1, this.cbs.onattribend(so.Unquoted, this.index), this.state = F.BeforeAttributeName, this.stateBeforeAttributeName(e)) : this.decodeEntities && e === P.Amp && this.startEntity();
	}
	stateBeforeDeclaration(e) {
		e === P.OpeningSquareBracket ? (this.state = F.CDATASequence, this.sequenceIndex = 0) : this.xmlMode ? this.state = e === P.Dash ? F.BeforeComment : F.InDeclaration : (e | 32) === I.Doctype[0] ? (this.state = F.DeclarationSequence, this.currentSequence = I.Doctype, this.sequenceIndex = 1) : e === P.Gt ? (this.cbs.oncomment(this.sectionStart, this.index, 0), this.state = F.Text, this.sectionStart = this.index + 1) : this.state = e === P.Dash ? F.BeforeComment : F.InSpecialComment;
	}
	stateDeclarationSequence(e) {
		this.sequenceIndex === this.currentSequence.length ? (this.state = F.InDeclaration, this.stateInDeclaration(e)) : (e | 32) === this.currentSequence[this.sequenceIndex] ? this.sequenceIndex += 1 : e === P.Gt ? (this.cbs.oncomment(this.sectionStart, this.index, 0), this.state = F.Text, this.sectionStart = this.index + 1) : this.state = F.InSpecialComment;
	}
	stateInDeclaration(e) {
		(e === P.Gt || this.fastForwardTo(P.Gt)) && (this.cbs.ondeclaration(this.sectionStart, this.index), this.state = F.Text, this.sectionStart = this.index + 1);
	}
	stateInProcessingInstruction(e) {
		e === P.Questionmark ? this.sequenceIndex = 1 : e === P.Gt && this.sequenceIndex === 1 ? (this.cbs.onprocessinginstruction(this.sectionStart, this.index - 1), this.sequenceIndex = 0, this.state = F.Text, this.sectionStart = this.index + 1) : this.sequenceIndex = Number(this.fastForwardTo(P.Questionmark));
	}
	stateBeforeComment(e) {
		e === P.Dash ? (this.state = F.InCommentLike, this.currentSequence = I.CommentEnd, this.sequenceIndex = 0, this.sectionStart = this.index + 1) : this.xmlMode ? this.state = F.InDeclaration : e === P.Gt ? (this.cbs.oncomment(this.sectionStart, this.index, 0), this.state = F.Text, this.sectionStart = this.index + 1) : this.state = F.InSpecialComment;
	}
	stateInSpecialComment(e) {
		(e === P.Gt || this.fastForwardTo(P.Gt)) && (this.cbs.oncomment(this.sectionStart, this.index, 0), this.state = F.Text, this.sectionStart = this.index + 1);
	}
	startEntity() {
		this.baseState = this.state, this.state = F.InEntity, this.entityStart = this.index, this.entityDecoder.startEntity(this.xmlMode ? to.Strict : this.baseState === F.Text || this.baseState === F.InSpecialTag ? to.Legacy : to.Attribute);
	}
	stateInEntity() {
		let e = this.index - this.offset, t = this.entityDecoder.write(this.buffer, e);
		if (t >= 0) this.state = this.baseState, t === 0 && --this.index;
		else {
			if (e < this.buffer.length && this.buffer.charCodeAt(e) === P.Amp) {
				this.state = this.baseState, --this.index;
				return;
			}
			this.index = this.offset + this.buffer.length - 1;
		}
	}
	cleanup() {
		this.running && this.sectionStart !== this.index && (this.state === F.Text || this.state === F.InPlainText || this.state === F.InSpecialTag && this.sequenceIndex === 0 ? (this.cbs.ontext(this.sectionStart, this.index), this.sectionStart = this.index) : (this.state === F.InAttributeValueDq || this.state === F.InAttributeValueSq || this.state === F.InAttributeValueNq) && (this.cbs.onattribdata(this.sectionStart, this.index), this.sectionStart = this.index));
	}
	shouldContinue() {
		return this.index < this.buffer.length + this.offset && this.running;
	}
	parse() {
		for (; this.shouldContinue();) {
			let e = this.buffer.charCodeAt(this.index - this.offset);
			switch (this.state) {
				case F.Text:
					this.stateText(e);
					break;
				case F.InPlainText:
					this.index = this.buffer.length + this.offset - 1;
					break;
				case F.SpecialStartSequence:
					this.stateSpecialStartSequence(e);
					break;
				case F.InSpecialTag:
					this.stateInSpecialTag(e);
					break;
				case F.CDATASequence:
					this.stateCDATASequence(e);
					break;
				case F.DeclarationSequence:
					this.stateDeclarationSequence(e);
					break;
				case F.InAttributeValueDq:
					this.stateInAttributeValueDoubleQuotes(e);
					break;
				case F.InAttributeName:
					this.stateInAttributeName(e);
					break;
				case F.InCommentLike:
					this.stateInCommentLike(e);
					break;
				case F.InSpecialComment:
					this.stateInSpecialComment(e);
					break;
				case F.BeforeAttributeName:
					this.stateBeforeAttributeName(e);
					break;
				case F.InTagName:
					this.stateInTagName(e);
					break;
				case F.InClosingTagName:
					this.stateInClosingTagName(e);
					break;
				case F.BeforeTagName:
					this.stateBeforeTagName(e);
					break;
				case F.AfterAttributeName:
					this.stateAfterAttributeName(e);
					break;
				case F.InAttributeValueSq:
					this.stateInAttributeValueSingleQuotes(e);
					break;
				case F.BeforeAttributeValue:
					this.stateBeforeAttributeValue(e);
					break;
				case F.BeforeClosingTagName:
					this.stateBeforeClosingTagName(e);
					break;
				case F.AfterClosingTagName:
					this.stateAfterClosingTagName(e);
					break;
				case F.InAttributeValueNq:
					this.stateInAttributeValueNoQuotes(e);
					break;
				case F.InSelfClosingTag:
					this.stateInSelfClosingTag(e);
					break;
				case F.InDeclaration:
					this.stateInDeclaration(e);
					break;
				case F.BeforeDeclaration:
					this.stateBeforeDeclaration(e);
					break;
				case F.BeforeComment:
					this.stateBeforeComment(e);
					break;
				case F.InProcessingInstruction:
					this.stateInProcessingInstruction(e);
					break;
				case F.InEntity: this.stateInEntity();
			}
			this.index++;
		}
		this.cleanup();
	}
	finish() {
		this.state === F.InEntity && (this.entityDecoder.end(), this.state = this.baseState), this.handleTrailingData(), this.cbs.onend();
	}
	handleTrailingCommentLikeData(e) {
		if (this.state !== F.InCommentLike) return !1;
		if (this.currentSequence === I.CdataEnd) {
			if (this.xmlMode) this.sectionStart < e && this.cbs.oncdata(this.sectionStart, e, 0);
			else {
				let t = this.sectionStart - I.Cdata.length - 1;
				this.cbs.oncomment(t, e, 0);
			}
		} else {
			let t = this.xmlMode ? 0 : Math.min(this.sequenceIndex, I.CommentEnd.length - 1);
			this.cbs.oncomment(this.sectionStart, e, t);
		}
		return !0;
	}
	handleTrailingMarkupDeclaration(e) {
		if (this.xmlMode) switch (this.state) {
			case F.InSpecialComment:
			case F.BeforeComment:
			case F.CDATASequence:
			case F.DeclarationSequence:
			case F.InDeclaration: return this.cbs.ontext(this.sectionStart, e), !0;
			default: return !1;
		}
		switch (this.state) {
			case F.BeforeDeclaration:
			case F.InSpecialComment:
			case F.BeforeComment:
			case F.CDATASequence: return this.cbs.oncomment(this.sectionStart, e, 0), !0;
			case F.DeclarationSequence: return this.sequenceIndex !== I.Doctype.length && this.cbs.oncomment(this.sectionStart, e, 0), !0;
			case F.InDeclaration: return !0;
			default: return !1;
		}
	}
	handleTrailingData() {
		let e = this.buffer.length + this.offset;
		if (!(this.handleTrailingCommentLikeData(e) || this.handleTrailingMarkupDeclaration(e)) && !(this.sectionStart >= e)) switch (this.state) {
			case F.InTagName:
			case F.BeforeAttributeName:
			case F.BeforeAttributeValue:
			case F.AfterAttributeName:
			case F.InAttributeName:
			case F.InAttributeValueSq:
			case F.InAttributeValueDq:
			case F.InAttributeValueNq:
			case F.InClosingTagName: break;
			default: this.cbs.ontext(this.sectionStart, e);
		}
	}
	emitCodePoint(e, t) {
		this.baseState !== F.Text && this.baseState !== F.InSpecialTag ? (this.sectionStart < this.entityStart && this.cbs.onattribdata(this.sectionStart, this.entityStart), this.sectionStart = this.entityStart + t, this.index = this.sectionStart - 1, this.cbs.onattribentity(e)) : (this.sectionStart < this.entityStart && this.cbs.ontext(this.sectionStart, this.entityStart), this.sectionStart = this.entityStart + t, this.index = this.sectionStart - 1, this.cbs.ontextentity(e, this.sectionStart));
	}
}, { fromCodePoint: uo } = String, fo = /* @__PURE__ */ new Set([
	"input",
	"option",
	"optgroup",
	"select",
	"button",
	"datalist",
	"textarea"
]), L = /* @__PURE__ */ new Set(["p"]), po = /* @__PURE__ */ new Set([
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"p"
]), mo = /* @__PURE__ */ new Set(["thead", "tbody"]), ho = /* @__PURE__ */ new Set(["dd", "dt"]), go = /* @__PURE__ */ new Set(["rt", "rp"]), _o = /* @__PURE__ */ new Map([
	["tr", /* @__PURE__ */ new Set([
		"tr",
		"th",
		"td"
	])],
	["th", /* @__PURE__ */ new Set(["th"])],
	["td", /* @__PURE__ */ new Set([
		"thead",
		"th",
		"td"
	])],
	["body", /* @__PURE__ */ new Set([
		"head",
		"link",
		"script"
	])],
	["a", /* @__PURE__ */ new Set(["a"])],
	["li", /* @__PURE__ */ new Set(["li"])],
	["p", L],
	["h1", po],
	["h2", po],
	["h3", po],
	["h4", po],
	["h5", po],
	["h6", po],
	["select", fo],
	["input", fo],
	["output", fo],
	["button", fo],
	["datalist", fo],
	["textarea", fo],
	["option", /* @__PURE__ */ new Set(["option"])],
	["optgroup", /* @__PURE__ */ new Set(["optgroup", "option"])],
	["dd", ho],
	["dt", ho],
	["address", L],
	["article", L],
	["aside", L],
	["blockquote", L],
	["details", L],
	["div", L],
	["dl", L],
	["fieldset", L],
	["figcaption", L],
	["figure", L],
	["footer", L],
	["form", L],
	["header", L],
	["hr", L],
	["main", L],
	["nav", L],
	["ol", L],
	["pre", L],
	["section", L],
	["table", L],
	["ul", L],
	["rt", go],
	["rp", go],
	["tbody", mo],
	["tfoot", mo]
]), vo = "doctype", yo = /* @__PURE__ */ new Set([
	"area",
	"base",
	"basefont",
	"br",
	"col",
	"command",
	"embed",
	"frame",
	"hr",
	"img",
	"input",
	"isindex",
	"keygen",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr"
]), bo = /* @__PURE__ */ new Set(["math", "svg"]), xo = /* @__PURE__ */ new Set([
	"mi",
	"mo",
	"mn",
	"ms",
	"mtext",
	"annotation-xml",
	"foreignObject",
	"desc",
	"title"
]), So = /* @__PURE__ */ new Map([
	["altglyph", "altGlyph"],
	["altglyphdef", "altGlyphDef"],
	["altglyphitem", "altGlyphItem"],
	["animatecolor", "animateColor"],
	["animatemotion", "animateMotion"],
	["animatetransform", "animateTransform"],
	["clippath", "clipPath"],
	["feblend", "feBlend"],
	["fecolormatrix", "feColorMatrix"],
	["fecomponenttransfer", "feComponentTransfer"],
	["fecomposite", "feComposite"],
	["feconvolvematrix", "feConvolveMatrix"],
	["fediffuselighting", "feDiffuseLighting"],
	["fedisplacementmap", "feDisplacementMap"],
	["fedistantlight", "feDistantLight"],
	["fedropshadow", "feDropShadow"],
	["feflood", "feFlood"],
	["fefunca", "feFuncA"],
	["fefuncb", "feFuncB"],
	["fefuncg", "feFuncG"],
	["fefuncr", "feFuncR"],
	["fegaussianblur", "feGaussianBlur"],
	["feimage", "feImage"],
	["femerge", "feMerge"],
	["femergenode", "feMergeNode"],
	["femorphology", "feMorphology"],
	["feoffset", "feOffset"],
	["fepointlight", "fePointLight"],
	["fespecularlighting", "feSpecularLighting"],
	["fespotlight", "feSpotLight"],
	["fetile", "feTile"],
	["feturbulence", "feTurbulence"],
	["foreignobject", "foreignObject"],
	["glyphref", "glyphRef"],
	["lineargradient", "linearGradient"],
	["radialgradient", "radialGradient"],
	["textpath", "textPath"]
]), Co;
(function(e) {
	e[e.None = 0] = "None", e[e.Svg = 1] = "Svg", e[e.MathML = 2] = "MathML";
})(Co ||= {});
var R = /\s|\//, wo = class {
	options;
	startIndex = 0;
	endIndex = 0;
	openTagStart = 0;
	tagname = "";
	attribname = "";
	attribvalue = "";
	attribs = null;
	stack = [];
	foreignContext;
	cbs;
	lowerCaseTagNames;
	lowerCaseAttributeNames;
	recognizeSelfClosing;
	htmlMode;
	tokenizer;
	buffers = [];
	bufferOffset = 0;
	writeIndex = 0;
	ended = !1;
	constructor(e, t = {}) {
		this.options = t, this.cbs = e ?? {}, this.htmlMode = !this.options.xmlMode, this.lowerCaseTagNames = t.lowerCaseTags ?? this.htmlMode, this.lowerCaseAttributeNames = t.lowerCaseAttributeNames ?? this.htmlMode, this.recognizeSelfClosing = t.recognizeSelfClosing ?? !this.htmlMode, this.tokenizer = new (t.Tokenizer ?? lo)(this.options, this), this.foreignContext = [Co.None], this.cbs.onparserinit?.(this);
	}
	ontext(e, t) {
		let n = this.getSlice(e, t);
		this.endIndex = t - 1, this.cbs.ontext?.(n), this.startIndex = t;
	}
	ontextentity(e, t) {
		this.endIndex = t - 1, this.cbs.ontext?.(uo(e)), this.startIndex = t;
	}
	isInForeignContext() {
		return this.foreignContext[0] !== Co.None;
	}
	isVoidElement(e) {
		return this.htmlMode && yo.has(e);
	}
	readTagName(e, t) {
		let n = this.lowerCaseTagNames ? this.getSlice(e, t).toLowerCase() : this.getSlice(e, t);
		if (!(this.lowerCaseTagNames && this.htmlMode)) return n;
		if (this.foreignContext[0] === Co.Svg) return So.get(n) ?? n;
		if (this.foreignContext.length > 1) {
			let e = So.get(n);
			if (e !== void 0 && this.stack.includes(e)) return e;
		}
		return this.isInForeignContext() ? n : n === "image" ? "img" : n;
	}
	onopentagname(e, t) {
		this.endIndex = t, this.emitOpenTag(this.readTagName(e, t));
	}
	emitOpenTag(e) {
		if (this.openTagStart = this.startIndex, this.tagname = e, this.htmlMode && e === "form" && this.stack.includes("form")) {
			this.tagname = "";
			return;
		}
		let t = this.htmlMode && _o.get(e);
		if (t) for (; this.stack.length > 0 && t.has(this.stack[0]);) this.popElement(!0);
		this.isVoidElement(e) || (this.stack.unshift(e), this.htmlMode && (e === "svg" ? this.foreignContext.unshift(Co.Svg) : e === "math" ? this.foreignContext.unshift(Co.MathML) : xo.has(e) && this.foreignContext.unshift(Co.None))), this.cbs.onopentagname?.(e), this.cbs.onopentag && (this.attribs = {});
	}
	endOpenTag(e) {
		this.startIndex = this.openTagStart, this.attribs &&= (this.cbs.onopentag?.(this.tagname, this.attribs, e), null), this.cbs.onclosetag && this.isVoidElement(this.tagname) && this.cbs.onclosetag(this.tagname, !0), this.tagname = "";
	}
	onopentagend(e) {
		this.endIndex = e, this.endOpenTag(!1), this.startIndex = e + 1;
	}
	onclosetag(e, t) {
		this.endIndex = t;
		let n = this.readTagName(e, t);
		if (this.isVoidElement(n)) this.htmlMode && n === "br" && (this.cbs.onopentagname?.("br"), this.cbs.onopentag?.("br", {}, !0), this.cbs.onclosetag?.("br", !1));
		else {
			let e = this.stack.indexOf(n);
			if (e !== -1) {
				for (let t = 0; t < e; t++) this.popElement(!0);
				this.popElement(!1);
			} else this.htmlMode && n === "p" && (this.emitOpenTag("p"), this.closeCurrentTag(!0));
		}
		this.startIndex = t + 1;
	}
	onselfclosingtag(e) {
		this.endIndex = e, this.recognizeSelfClosing || this.isInForeignContext() ? (this.closeCurrentTag(!1), this.startIndex = e + 1) : this.onopentagend(e);
	}
	popElement(e) {
		let t = this.stack.shift();
		this.htmlMode && (bo.has(t) || xo.has(t)) && this.foreignContext.shift(), this.cbs.onclosetag?.(t, e);
	}
	closeCurrentTag(e) {
		let t = this.tagname;
		this.endOpenTag(e), this.stack[0] === t && this.popElement(!e);
	}
	onattribname(e, t) {
		this.startIndex = e;
		let n = this.getSlice(e, t);
		this.attribname = this.lowerCaseAttributeNames ? n.toLowerCase() : n;
	}
	onattribdata(e, t) {
		this.attribvalue += this.getSlice(e, t);
	}
	onattribentity(e) {
		this.attribvalue += uo(e);
	}
	onattribend(e, t) {
		this.endIndex = t, this.cbs.onattribute?.(this.attribname, this.attribvalue, e === so.Double ? "\"" : e === so.Single ? "'" : e === so.NoValue ? void 0 : null), this.attribs && !Object.hasOwn(this.attribs, this.attribname) && (this.attribs[this.attribname] = this.attribvalue), this.attribvalue = "";
	}
	getInstructionName(e) {
		let t = e.search(R), n = t < 0 ? e : e.substr(0, t);
		return this.lowerCaseTagNames && (n = n.toLowerCase()), n;
	}
	ondeclaration(e, t) {
		this.endIndex = t;
		let n = this.getSlice(e, t);
		if (this.cbs.onprocessinginstruction) {
			let e = this.htmlMode ? this.lowerCaseTagNames ? vo : n.slice(0, 7) : this.getInstructionName(n);
			this.cbs.onprocessinginstruction(`!${e}`, `!${n}`);
		}
		this.startIndex = t + 1;
	}
	onprocessinginstruction(e, t) {
		this.endIndex = t;
		let n = this.getSlice(e, t);
		if (this.cbs.onprocessinginstruction) {
			let e = this.getInstructionName(n);
			this.cbs.onprocessinginstruction(`?${e}`, `?${n}`);
		}
		this.startIndex = t + 1;
	}
	oncomment(e, t, n) {
		this.endIndex = t, this.cbs.oncomment?.(this.getSlice(e, t - n)), this.cbs.oncommentend?.(), this.startIndex = t + 1;
	}
	oncdata(e, t, n) {
		this.endIndex = t;
		let r = this.getSlice(e, t - n);
		!this.htmlMode || this.options.recognizeCDATA ? (this.cbs.oncdatastart?.(), this.cbs.ontext?.(r), this.cbs.oncdataend?.()) : this.isInForeignContext() ? this.cbs.ontext?.(r) : (this.cbs.oncomment?.(`[CDATA[${r}]]`), this.cbs.oncommentend?.()), this.startIndex = t + 1;
	}
	onend() {
		if (this.cbs.onclosetag) {
			this.endIndex = this.startIndex;
			for (let e = 0; e < this.stack.length; e++) this.cbs.onclosetag(this.stack[e], !0);
		}
		this.cbs.onend?.();
	}
	reset() {
		this.cbs.onreset?.(), this.tokenizer.reset(), this.tagname = "", this.attribname = "", this.attribvalue = "", this.attribs = null, this.stack.length = 0, this.startIndex = 0, this.endIndex = 0, this.cbs.onparserinit?.(this), this.buffers.length = 0, this.foreignContext.length = 0, this.foreignContext.unshift(Co.None), this.bufferOffset = 0, this.writeIndex = 0, this.ended = !1;
	}
	parseComplete(e) {
		this.reset(), this.end(e);
	}
	getSlice(e, t) {
		if (e === t) return "";
		for (; e - this.bufferOffset >= this.buffers[0].length;) this.shiftBuffer();
		let n = this.buffers[0].slice(e - this.bufferOffset, t - this.bufferOffset);
		for (; t - this.bufferOffset > this.buffers[0].length;) this.shiftBuffer(), n += this.buffers[0].slice(0, t - this.bufferOffset);
		return n;
	}
	shiftBuffer() {
		this.bufferOffset += this.buffers[0].length, this.writeIndex--, this.buffers.shift();
	}
	write(e) {
		if (this.ended) {
			this.cbs.onerror?.(/* @__PURE__ */ Error(".write() after done!"));
			return;
		}
		this.buffers.push(e), this.tokenizer.running && (this.tokenizer.write(e), this.writeIndex++);
	}
	end(e) {
		if (this.ended) {
			this.cbs.onerror?.(/* @__PURE__ */ Error(".end() after done!"));
			return;
		}
		e && this.write(e), this.ended = !0, this.tokenizer.end();
	}
	pause() {
		this.tokenizer.pause();
	}
	resume() {
		for (this.tokenizer.resume(); this.tokenizer.running && this.writeIndex < this.buffers.length;) this.tokenizer.write(this.buffers[this.writeIndex++]);
		this.ended && this.tokenizer.end();
	}
}, z;
(function(e) {
	e.Root = "root", e.Text = "text", e.Directive = "directive", e.Comment = "comment", e.Script = "script", e.Style = "style", e.Tag = "tag", e.CDATA = "cdata", e.Doctype = "doctype";
})(z ||= {});
function To(e) {
	return e.type === z.Tag || e.type === z.Script || e.type === z.Style;
}
z.Root;
var Eo = z.Text;
z.Directive;
var Do = z.Comment, Oo = z.Script, ko = z.Style, Ao = z.Tag, jo = z.CDATA;
z.Doctype;
//#endregion
//#region ../../node_modules/domhandler/dist/node.js
var Mo = class {
	parent = null;
	prev = null;
	next = null;
	startIndex = null;
	endIndex = null;
	get parentNode() {
		return this.parent;
	}
	set parentNode(e) {
		this.parent = e;
	}
	get previousSibling() {
		return this.prev;
	}
	set previousSibling(e) {
		this.prev = e;
	}
	get nextSibling() {
		return this.next;
	}
	set nextSibling(e) {
		this.next = e;
	}
	cloneNode(e = !1) {
		return qo(this, e);
	}
}, No = class extends Mo {
	data;
	constructor(e) {
		super(), this.data = e;
	}
	get nodeValue() {
		return this.data;
	}
	set nodeValue(e) {
		this.data = e;
	}
}, Po = class extends No {
	type = z.Text;
	get nodeType() {
		return 3;
	}
}, Fo = class extends No {
	type = z.Comment;
	get nodeType() {
		return 8;
	}
}, Io = class extends No {
	type = z.Directive;
	name;
	constructor(e, t) {
		super(t), this.name = e;
	}
	get nodeType() {
		return 1;
	}
	"x-name";
	"x-publicId";
	"x-systemId";
}, Lo = class extends Mo {
	children;
	constructor(e) {
		super(), this.children = e;
	}
	get firstChild() {
		return this.children[0] ?? null;
	}
	get lastChild() {
		return this.children.length > 0 ? this.children[this.children.length - 1] : null;
	}
	get childNodes() {
		return this.children;
	}
	set childNodes(e) {
		this.children = e;
	}
}, Ro = class extends Lo {
	type = z.CDATA;
	get nodeType() {
		return 4;
	}
}, zo = class extends Lo {
	type = z.Root;
	get nodeType() {
		return 9;
	}
}, Bo = class extends Lo {
	name;
	attribs;
	type;
	constructor(e, t, n = [], r = e === "script" ? z.Script : e === "style" ? z.Style : z.Tag) {
		super(n), this.name = e, this.attribs = t, this.type = r;
	}
	get nodeType() {
		return 1;
	}
	get tagName() {
		return this.name;
	}
	set tagName(e) {
		this.name = e;
	}
	get attributes() {
		return Object.keys(this.attribs).map((e) => ({
			name: e,
			value: this.attribs[e],
			namespace: this["x-attribsNamespace"]?.[e],
			prefix: this["x-attribsPrefix"]?.[e]
		}));
	}
	namespace;
	"x-attribsNamespace";
	"x-attribsPrefix";
};
function Vo(e) {
	return To(e);
}
function Ho(e) {
	return e.type === z.CDATA;
}
function Uo(e) {
	return e.type === z.Text;
}
function Wo(e) {
	return e.type === z.Comment;
}
function Go(e) {
	return e.type === z.Directive;
}
function Ko(e) {
	return e.type === z.Root;
}
function qo(e, t = !1) {
	let n;
	if (Uo(e)) n = new Po(e.data);
	else if (Wo(e)) n = new Fo(e.data);
	else if (Vo(e)) {
		let r = t ? B(e.children) : [], i = new Bo(e.name, { ...e.attribs }, r);
		for (let e of r) e.parent = i;
		e.namespace != null && (i.namespace = e.namespace), e["x-attribsNamespace"] && (i["x-attribsNamespace"] = { ...e["x-attribsNamespace"] }), e["x-attribsPrefix"] && (i["x-attribsPrefix"] = { ...e["x-attribsPrefix"] }), n = i;
	} else if (Ho(e)) {
		let r = t ? B(e.children) : [], i = new Ro(r);
		for (let e of r) e.parent = i;
		n = i;
	} else if (Ko(e)) {
		let r = t ? B(e.children) : [], i = new zo(r);
		for (let e of r) e.parent = i;
		e["x-mode"] && (i["x-mode"] = e["x-mode"]), n = i;
	} else if (Go(e)) {
		let t = new Io(e.name, e.data);
		e["x-name"] != null && (t["x-name"] = e["x-name"], t["x-publicId"] = e["x-publicId"], t["x-systemId"] = e["x-systemId"]), n = t;
	} else throw Error(`Not implemented yet: ${e.type}`);
	return n.startIndex = e.startIndex, n.endIndex = e.endIndex, e.sourceCodeLocation != null && (n.sourceCodeLocation = e.sourceCodeLocation), n;
}
function B(e) {
	let t = e.map((e) => qo(e, !0));
	for (let e = 1; e < t.length; e++) t[e].prev = t[e - 1], t[e - 1].next = t[e];
	return t;
}
//#endregion
//#region ../../node_modules/domhandler/dist/index.js
var Jo = {
	withStartIndices: !1,
	withEndIndices: !1,
	xmlMode: !1
}, Yo = class {
	dom = [];
	root = new zo(this.dom);
	callback;
	options;
	elementCB;
	done = !1;
	tagStack = [this.root];
	lastNode = null;
	parser = null;
	constructor(e, t, n) {
		typeof t == "function" && (n = t, t = Jo), typeof e == "object" && (t = e, e = void 0), this.callback = e ?? null, this.options = t ?? Jo, this.elementCB = n ?? null;
	}
	onparserinit(e) {
		this.parser = e;
	}
	onreset() {
		this.dom = [], this.root = new zo(this.dom), this.done = !1, this.tagStack = [this.root], this.lastNode = null, this.parser = null;
	}
	onend() {
		this.done || (this.done = !0, this.parser = null, this.handleCallback(null));
	}
	onerror(e) {
		this.handleCallback(e);
	}
	onclosetag() {
		this.lastNode = null;
		let e = this.tagStack.pop();
		this.options.withEndIndices && this.parser && (e.endIndex = this.parser.endIndex), this.elementCB && this.elementCB(e);
	}
	onopentag(e, t) {
		let n = new Bo(e, t, void 0, this.options.xmlMode ? z.Tag : void 0);
		this.addNode(n), this.tagStack.push(n);
	}
	ontext(e) {
		let { lastNode: t } = this;
		if (t && t.type === z.Text) t.data += e, this.options.withEndIndices && this.parser && (t.endIndex = this.parser.endIndex);
		else {
			let t = new Po(e);
			this.addNode(t), this.lastNode = t;
		}
	}
	oncomment(e) {
		if (this.lastNode && this.lastNode.type === z.Comment) {
			this.lastNode.data += e;
			return;
		}
		let t = new Fo(e);
		this.addNode(t), this.lastNode = t;
	}
	oncommentend() {
		this.lastNode = null;
	}
	oncdatastart() {
		let e = new Po(""), t = new Ro([e]);
		this.addNode(t), e.parent = t, this.lastNode = e;
	}
	oncdataend() {
		this.lastNode = null;
	}
	onprocessinginstruction(e, t) {
		let n = new Io(e, t);
		this.addNode(n);
	}
	handleCallback(e) {
		if (typeof this.callback == "function") this.callback(e, this.dom);
		else if (e) throw e;
	}
	addNode(e) {
		let t = this.tagStack[this.tagStack.length - 1], n = t.children[t.children.length - 1];
		this.options.withStartIndices && this.parser && (e.startIndex = this.parser.startIndex), this.options.withEndIndices && this.parser && (e.endIndex = this.parser.endIndex), t.children.push(e), n && (e.prev = n, n.next = e), e.parent = t, this.lastNode = null;
	}
};
//#endregion
//#region ../../node_modules/htmlparser2/dist/index.js
function Xo(e, t) {
	let n = new Yo(void 0, t);
	return new wo(n, t).end(e), n.root;
}
//#endregion
//#region ../../packages/islands/src/worker/dom/html.ts
function Zo(e, t) {
	let n = Xo(String(t)), r = (t) => {
		let n = [];
		for (let i of t) switch (i.type) {
			case Ao:
			case Oo:
			case ko: {
				let t = e.createElement(i.name);
				for (let [e, n] of Object.entries(i.attribs)) t.setAttribute(e, n);
				for (let e of r(i.children)) t.appendChild(e);
				n.push(t);
				break;
			}
			case Eo:
				i.data !== "" && n.push(e.createTextNode(i.data));
				break;
			case Do:
				n.push(e.createComment(i.data));
				break;
			case jo: for (let e of r(i.children)) n.push(e);
		}
		return n;
	};
	return r(n.children);
}
var Qo = /* @__PURE__ */ new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr"
]), $o = (e) => e.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), es = (e) => e.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
function ts(e) {
	if (e instanceof La) return `<!--${e.data}-->`;
	if (e instanceof Ia) return $o(e.textContent);
	if (!(e instanceof ms)) return "";
	let t = e.instance.type, n = new Map(e._attrs), r = Object.entries(e._styleProps).map(([e, t]) => `${Oa(e)}: ${t};`).join(" ");
	r !== "" && n.set("style", r);
	let i = `<${t}`;
	for (let [e, t] of n) i += ` ${e}="${es(t)}"`;
	if (Qo.has(t)) return `${i}>`;
	i += ">";
	for (let t of e._children) i += ts(t);
	return `${i}</${t}>`;
}
//#endregion
//#region ../../packages/islands/src/worker/dom/selectors.ts
var ns = (e) => {
	throw Error(`proxyDom.querySelector: unsupported selector "${e}" — only tag, .class, #id, [attr], [attr="v"] and descendant combinators are supported`);
};
function rs(e, t) {
	let n = {
		classes: [],
		attrs: []
	}, r = 0, i = /^[a-zA-Z][\w-]*/.exec(e);
	for (i !== null && (n.tag = i[0].toLowerCase(), r = i[0].length); r < e.length;) {
		let i = e[r];
		if (i === "#") {
			let i = /^[\w-]+/.exec(e.slice(r + 1));
			i === null && ns(t), n.id = i[0], r += 1 + i[0].length;
		} else if (i === ".") {
			let i = /^[\w-]+/.exec(e.slice(r + 1));
			i === null && ns(t), n.classes.push(i[0]), r += 1 + i[0].length;
		} else if (i === "[") {
			let i = e.indexOf("]", r);
			i === -1 && ns(t);
			let a = e.slice(r + 1, i).trim(), o = /^([\w-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^'"\s]+)))?$/.exec(a);
			o === null && ns(t), n.attrs.push({
				name: o[1],
				value: o[2] ?? o[3] ?? o[4]
			}), r = i + 1;
		} else ns(t);
	}
	return n.tag === void 0 && n.id === void 0 && n.classes.length === 0 && n.attrs.length === 0 && ns(t), n;
}
function is(e) {
	let t = e.trim();
	return (t === "" || t.includes(",") || t.includes(">") || t.includes("+") || t.includes("~") || t.includes(":")) && ns(e), t.split(/\s+/).map((t) => rs(t, e));
}
function as(e, t) {
	if (t.tag !== void 0 && e.tagName.toLowerCase() !== t.tag || t.id !== void 0 && e._attrs.get("id") !== t.id) return !1;
	for (let n of t.classes) if (!e._classes.has(n)) return !1;
	for (let n of t.attrs) {
		let t = e._attrs.get(n.name);
		if (t === void 0 || n.value !== void 0 && t !== n.value) return !1;
	}
	return !0;
}
function os(e, t) {
	if (!as(e, t[t.length - 1])) return !1;
	let n = e._parent;
	for (let e = t.length - 2; e >= 0; e--) {
		let r = !1;
		for (; n !== null;) {
			if (n instanceof ms && as(n, t[e])) {
				r = !0, n = n._parent;
				break;
			}
			n = n._parent;
		}
		if (!r) return !1;
	}
	return !0;
}
//#endregion
//#region ../../packages/islands/src/worker/dom/css.ts
var ss = /* @__PURE__ */ new WeakMap(), cs = /* @__PURE__ */ new WeakMap(), ls = /* @__PURE__ */ new WeakMap();
function us(e) {
	let t = [...e._classes].join(" ");
	e._attrs.set("class", t), e._op({
		t: "attr",
		id: e.instance.id,
		name: "class",
		value: t === "" ? null : t
	});
}
function V(e) {
	let t = ss.get(e);
	return t === void 0 && (t = {
		add: (...t) => {
			let n = !1;
			for (let r of t) r !== "" && !e._classes.has(r) && (e._classes.add(r), n = !0);
			n && us(e);
		},
		remove: (...t) => {
			let n = !1;
			for (let r of t) n = e._classes.delete(r) || n;
			n && us(e);
		},
		toggle: (t, n) => {
			let r = e._classes.has(t), i = n ?? !r;
			return i === r ? r : (i ? e._classes.add(t) : e._classes.delete(t), us(e), i);
		},
		contains: (t) => e._classes.has(t),
		get value() {
			return e._attrs.get("class") ?? "";
		}
	}, ss.set(e, t)), t;
}
function ds(e) {
	let t = cs.get(e);
	return t === void 0 && (t = new Proxy(e._styleProps, {
		get: (t, n) => {
			if (n === "setProperty") return (t, n, r) => {
				let i = t.startsWith("--") ? t : ka(t);
				e._writeStyle(i, r === "important" && n !== "" ? `${n} !important` : n);
			};
			if (n === "removeProperty") return (t) => e._writeStyle(t.startsWith("--") ? t : ka(t), "");
			if (n === "getPropertyValue") return (e) => {
				let n = e.startsWith("--") ? e : ka(e);
				return String(t[n] ?? "").replace(/\s*!important$/, "");
			};
			if (n === "cssText") return Object.entries(t).map(([e, t]) => `${Oa(e)}: ${t};`).join(" ");
			if (typeof n == "string") return t[n] ?? "";
		},
		set: (t, n, r) => (typeof n == "string" && e._writeStyle(n, String(r)), !0),
		deleteProperty: (t, n) => (typeof n == "string" && e._writeStyle(n, ""), !0),
		has: (e, t) => t in e,
		ownKeys: (e) => Reflect.ownKeys(e),
		getOwnPropertyDescriptor: (e, t) => typeof t == "string" && t in e ? {
			configurable: !0,
			enumerable: !0,
			value: e[t]
		} : void 0
	}), cs.set(e, t)), t;
}
function fs(e) {
	let t = ls.get(e);
	return t === void 0 && (t = new Proxy({}, {
		get: (t, n) => {
			if (typeof n == "string") return e.getAttribute(`data-${Oa(n)}`) ?? void 0;
		},
		set: (t, n, r) => (typeof n == "string" && e.setAttribute(`data-${Oa(n)}`, r), !0),
		deleteProperty: (t, n) => (typeof n == "string" && e.removeAttribute(`data-${Oa(n)}`), !0),
		has: (t, n) => typeof n == "string" && e._attrs.has(`data-${Oa(n)}`),
		ownKeys: () => [...e._attrs.keys()].filter((e) => e.startsWith("data-")).map((e) => ka(e.slice(5))),
		getOwnPropertyDescriptor: (t, n) => {
			if (typeof n != "string") return;
			let r = e.getAttribute(`data-${Oa(n)}`);
			return r === null ? void 0 : {
				configurable: !0,
				enumerable: !0,
				value: r
			};
		}
	}), ls.set(e, t)), t;
}
//#endregion
//#region ../../packages/islands/src/worker/dom/element.ts
var ps = /* @__PURE__ */ new WeakMap(), ms = class e extends Fa {
	_attrs = /* @__PURE__ */ new Map();
	_classes = /* @__PURE__ */ new Set();
	_styleProps = {};
	_listeners = [];
	get nodeType() {
		return 1;
	}
	get tagName() {
		return this.instance.type.toUpperCase();
	}
	get namespaceURI() {
		return this.instance.ns ?? "http://www.w3.org/1999/xhtml";
	}
	get children() {
		return this._children.filter((t) => t instanceof e);
	}
	get id() {
		return this._attrs.get("id") ?? "";
	}
	set id(e) {
		this._setAttr("id", e);
	}
	get className() {
		return this._attrs.get("class") ?? "";
	}
	set className(e) {
		this._setAttr("class", e);
	}
	getAttribute(e) {
		return this._attrs.get(e) ?? null;
	}
	hasAttribute(e) {
		return this._attrs.has(e);
	}
	setAttribute(e, t) {
		this._setAttr(e, t);
	}
	removeAttribute(e) {
		this.doc._assertAlive(), this._attrs.has(e) && (this._attrs.delete(e), this._afterAttrChange(e), this._op({
			t: "attr",
			id: this.instance.id,
			name: e,
			value: null
		}));
	}
	setAttributeNS(e, t, n) {
		this.setAttribute(t, n);
	}
	getAttributeNS(e, t) {
		let n = this.getAttribute(t);
		if (n !== null) return n;
		for (let e of this._attrs.keys()) if (e.endsWith(`:${t}`)) return this.getAttribute(e);
		return null;
	}
	removeAttributeNS(e, t) {
		if (this.getAttribute(t) !== null) {
			this.removeAttribute(t);
			return;
		}
		for (let e of [...this._attrs.keys()]) e.endsWith(`:${t}`) && this.removeAttribute(e);
	}
	get classList() {
		return V(this);
	}
	get style() {
		return ds(this);
	}
	get dataset() {
		return fs(this);
	}
	focus() {}
	blur() {}
	addEventListener(e, t, n) {
		this.doc._assertAlive();
		let r = Ea(n);
		if (this._listeners.some((n) => n.type === e && n.fn === t && n.capture === r.capture)) return;
		let i = ba((n) => {
			try {
				t.call(this, this.doc._enrichEvent(n, this));
			} finally {
				r.once && this.removeEventListener(e, t, { capture: r.capture });
			}
		}, this.instance.instance, this.instance.id);
		this._listeners.push({
			type: e,
			fn: t,
			hid: i,
			capture: r.capture
		}), this.doc._handlerIds.add(i), this._op({
			t: "listen",
			id: this.instance.id,
			type: e,
			handler: i,
			opts: Da(n)
		});
	}
	removeEventListener(e, t, n) {
		this.doc._assertAlive();
		let r = Ea(n).capture, i = this._listeners.findIndex((n) => n.type === e && n.fn === t && n.capture === r);
		if (i === -1) return;
		let [a] = this._listeners.splice(i, 1);
		xa(a.hid), this.doc._handlerIds.delete(a.hid), this._op({
			t: "unlisten",
			id: this.instance.id,
			type: e,
			handler: a.hid,
			opts: a.capture ? { capture: !0 } : void 0
		});
	}
	getElementsByClassName(t) {
		this.doc._assertAlive();
		let n = [], r = (i) => {
			for (let a of i._children) {
				if (!(a instanceof e)) continue;
				let i = (a.instance.props?.className ?? "").split(/\s+/).includes(t);
				(a._classes.has(t) || i) && n.push(a), r(a);
			}
		};
		return r(this), n;
	}
	getElementsByTagName(t) {
		this.doc._assertAlive();
		let n = t.toLowerCase(), r = [], i = (t) => {
			for (let a of t._children) a instanceof e && ((n === "*" || a.instance.type.toLowerCase() === n) && r.push(a), i(a));
		};
		return i(this), r;
	}
	getBBox() {
		return this.doc._assertAlive(), this.doc._warn("getBBox"), {
			x: 0,
			y: 0,
			width: 0,
			height: 0,
			top: 0,
			right: 0,
			bottom: 0,
			left: 0
		};
	}
	getTotalLength() {
		return this.doc._assertAlive(), this.doc._warn("getTotalLength"), 0;
	}
	getComputedTextLength() {
		return this.doc._assertAlive(), this.doc._warn("getComputedTextLength"), 0;
	}
	matches(e) {
		return os(this, is(e));
	}
	closest(t) {
		let n = is(t), r = this;
		for (; r !== null;) {
			if (r instanceof e && os(r, n)) return r;
			r = r._parent;
		}
		return null;
	}
	querySelector(e) {
		return this.querySelectorAll(e)[0] ?? null;
	}
	querySelectorAll(t) {
		let n = is(t), r = [], i = (t) => {
			for (let a of t._children) a instanceof e && os(a, n) && r.push(a), i(a);
		};
		return i(this), r;
	}
	get innerHTML() {
		return this._children.map((e) => ts(e)).join("");
	}
	get outerHTML() {
		return ts(this);
	}
	set innerHTML(e) {
		this.doc._assertAlive();
		for (let e of this._children.slice()) this.removeChild(e);
		for (let t of Zo(this.doc, e)) this.appendChild(t);
	}
	insertAdjacentHTML(e, t) {
		this.doc._assertAlive(), this._insertAt(e, Zo(this.doc, t));
	}
	insertAdjacentElement(t, n) {
		return this.doc._assertAlive(), n instanceof e ? (this._insertAt(t, [n]), n) : null;
	}
	_insertAt(e, t) {
		switch (e) {
			case "beforebegin":
				if (this._parent === null) return;
				for (let e of t) this._parent.insertBefore(e, this);
				return;
			case "afterbegin": {
				let e = this.firstChild;
				for (let n of t) this.insertBefore(n, e);
				return;
			}
			case "beforeend":
				for (let e of t) this.appendChild(e);
				return;
			case "afterend": {
				if (this._parent === null) return;
				let e = this.nextSibling;
				for (let n of t) this._parent.insertBefore(n, e);
				return;
			}
			default: throw Error(`proxyDom.insertAdjacent*: unknown position "${String(e)}"`);
		}
	}
	get content() {
		if (this.instance.type !== "template") return;
		let e = ps.get(this);
		return e === void 0 && (e = this.doc.createDocumentFragment(), e._children = this._children, e.instance = this.instance, ps.set(this, e)), e;
	}
	cloneNode(e) {
		this.doc._assertAlive();
		let t = this.instance.ns === void 0 ? this.doc.createElement(this.instance.type) : this.doc.createElementNS(this.instance.ns, this.instance.type);
		for (let [e, n] of this._attrs) t.setAttribute(e, n);
		for (let [e, n] of Object.entries(this._styleProps)) t._writeStyle(e, n);
		if (e === !0) for (let e of this._children) t.appendChild(e.cloneNode(!0));
		return t;
	}
	getBoundingClientRect() {
		let e = this.doc._sizeFor(this);
		return e === void 0 ? (this.doc._warn("getBoundingClientRect"), {
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			width: 0,
			height: 0,
			toJSON: () => ({})
		}) : {
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: e.w,
			bottom: e.h,
			width: e.w,
			height: e.h,
			toJSON: () => ({})
		};
	}
	get clientWidth() {
		return this._geom("clientWidth", (e) => e.w);
	}
	get clientHeight() {
		return this._geom("clientHeight", (e) => e.h);
	}
	get offsetWidth() {
		return this._geom("offsetWidth", (e) => e.w);
	}
	get offsetHeight() {
		return this._geom("offsetHeight", (e) => e.h);
	}
	get clientLeft() {
		return 0;
	}
	get clientTop() {
		return 0;
	}
	get offsetLeft() {
		return 0;
	}
	get offsetTop() {
		return 0;
	}
	get offsetParent() {
		return null;
	}
	get scrollTop() {
		return this.doc._warn("scrollTop"), 0;
	}
	set scrollTop(e) {
		this.doc._warn("scrollTop");
	}
	get scrollLeft() {
		return this.doc._warn("scrollLeft"), 0;
	}
	set scrollLeft(e) {
		this.doc._warn("scrollLeft");
	}
	get scrollHeight() {
		return this.doc._warn("scrollHeight"), 0;
	}
	get scrollWidth() {
		return this.doc._warn("scrollWidth"), 0;
	}
	get src() {
		return this._attrs.get("src") ?? "";
	}
	set src(e) {
		this._setAttr("src", e);
	}
	get srcset() {
		return this._attrs.get("srcset") ?? "";
	}
	set srcset(e) {
		this._setAttr("srcset", e);
	}
	get href() {
		return this._attrs.get("href") ?? "";
	}
	set href(e) {
		this._setAttr("href", e);
	}
	get alt() {
		return this._attrs.get("alt") ?? "";
	}
	set alt(e) {
		this._setAttr("alt", e);
	}
	get title() {
		return this._attrs.get("title") ?? "";
	}
	set title(e) {
		this._setAttr("title", e);
	}
	get tabIndex() {
		return Number(this._attrs.get("tabindex") ?? -1);
	}
	set tabIndex(e) {
		this._setAttr("tabindex", String(e));
	}
	get draggable() {
		return this._attrs.get("draggable") === "true";
	}
	set draggable(e) {
		this._setAttr("draggable", String(e));
	}
	get crossOrigin() {
		return this._attrs.get("crossorigin") ?? null;
	}
	set crossOrigin(e) {
		e === null ? this.removeAttribute("crossorigin") : this._setAttr("crossorigin", e);
	}
	get width() {
		return Number(this._attrs.get("width") ?? 0);
	}
	set width(e) {
		this._setAttr("width", String(e));
	}
	get height() {
		return Number(this._attrs.get("height") ?? 0);
	}
	set height(e) {
		this._setAttr("height", String(e));
	}
	get type() {
		return this._attrs.get("type") ?? "";
	}
	set type(e) {
		this._setAttr("type", e);
	}
	get loading() {
		return this._attrs.get("loading") ?? "";
	}
	set loading(e) {
		this._setAttr("loading", e);
	}
	get decoding() {
		return this._attrs.get("decoding") ?? "";
	}
	set decoding(e) {
		this._setAttr("decoding", e);
	}
	get value() {
		return this._attrs.get("value") ?? "";
	}
	set value(e) {
		this._setAttr("value", e);
	}
	get checked() {
		return this._attrs.has("checked");
	}
	set checked(e) {
		e ? this._setAttr("checked", "") : this.removeAttribute("checked");
	}
	get disabled() {
		return this._attrs.has("disabled");
	}
	set disabled(e) {
		e ? this._setAttr("disabled", "") : this.removeAttribute("disabled");
	}
	_geom(e, t) {
		let n = this.doc._sizeFor(this);
		return n === void 0 ? (this.doc._warn(e), 0) : t(n);
	}
	_writeStyle(e, t) {
		this.doc._assertAlive(), this._styleProps[e] !== t && (this._styleProps[e] = t, this._op({
			t: "style",
			id: this.instance.id,
			props: { [e]: t }
		}));
	}
	_setAttr(e, t) {
		this.doc._assertAlive();
		let n = String(t);
		this._attrs.get(e) !== n && (this._attrs.set(e, n), this._afterAttrChange(e), this._op({
			t: "attr",
			id: this.instance.id,
			name: e,
			value: n
		}));
	}
	_afterAttrChange(e) {
		e === "class" ? this._classes = new Set((this._attrs.get("class") ?? "").split(/\s+/).filter(Boolean)) : e === "id" && this.doc._trackId(this);
	}
}, hs = class {
	instance;
	_root;
	_wrappers = /* @__PURE__ */ new Map();
	_ids = /* @__PURE__ */ new Map();
	_handlerIds = /* @__PURE__ */ new Set();
	_containerIds = /* @__PURE__ */ new Set([0]);
	_resizeHandlers = /* @__PURE__ */ new Set();
	_windowBundle;
	get defaultView() {
		return this._windowBundle?.facade;
	}
	_docListeners = [];
	_warned = /* @__PURE__ */ new Set();
	_disposed = !1;
	_uninstallShim = null;
	constructor(e) {
		this.instance = e, this._root = new ms(this, {
			kind: "element",
			id: 0,
			type: "#root",
			instance: e,
			props: {},
			listenerSlots: {}
		}), this._wrappers.set(0, this._root);
	}
	get body() {
		return this._root;
	}
	get documentElement() {
		return this._root;
	}
	elementFromPoint(e, t) {
		return this._assertAlive(), this._warn("elementFromPoint"), null;
	}
	_assertAlive() {
		if (this._disposed) throw Error("proxyDom: this document was disposed by an updateProps/remount rebuild — its nodes are detached");
	}
	_warn(e) {
		this._warned.has(e) || (this._warned.add(e), console.warn(`[proxyDom] '${e}' has no measurement channel — the only geometry the worker sees is the pushed container size (setSize); reads on unmarked elements return 0/empty.`));
	}
	markContainer(e) {
		this._assertAlive(), this._containerIds.add(e.instance.id);
	}
	_sizeFor(e) {
		if (this._containerIds.has(e.instance.id)) return va(this.instance);
	}
	onResize(e) {
		this._assertAlive(), this._resizeHandlers.add(e);
	}
	_notifySize(e, t) {
		for (let n of [...this._resizeHandlers]) n(e, t);
	}
	_trackId(e) {
		for (let [t, n] of this._ids) n === e && this._ids.delete(t);
		let t = e._attrs.get("id");
		t !== void 0 && t !== "" && this._ids.set(t, e);
	}
	_phantomText(e, t) {
		let n = new Ia(this, {
			kind: "text",
			id: ja(),
			text: t,
			instance: e.instance.instance
		});
		return n._parent = e, n;
	}
	_enrichEvent(e, t) {
		let n = {
			...e,
			preventDefault: () => {},
			stopPropagation: () => {},
			stopImmediatePropagation: () => {}
		};
		t !== void 0 && (n.currentTarget = t);
		let r = e.targetId;
		if (typeof r == "number") {
			let t = ea.get(r);
			if (t !== void 0) {
				let r = this._wrap(t);
				r instanceof ms && (e.value !== void 0 && r._attrs.set("value", String(e.value)), e.checked !== void 0 && (e.checked ? r._attrs.set("checked", "") : r._attrs.delete("checked"))), n.target = r;
			}
		}
		if (n.composedPath === void 0) {
			let e = [], r = n.target;
			for (; r instanceof Fa;) e.push(r), r = r._parent ?? void 0;
			t !== void 0 && !e.includes(t) && e.push(t), n.composedPath = () => e;
		}
		return n;
	}
	createElement(e) {
		return this._newElement(e.toLowerCase(), void 0);
	}
	createElementNS(e, t) {
		return this._newElement(t, e);
	}
	_newElement(e, t) {
		this._assertAlive();
		let n = {
			kind: "element",
			id: oa(),
			type: e,
			ns: t,
			instance: this.instance,
			props: {},
			listenerSlots: {}
		};
		return ea.set(n.id, n), N(this.instance, {
			t: "create",
			id: n.id,
			type: n.type,
			props: {},
			ns: n.ns
		}), la() !== this.instance && ma(), this._wrap(n);
	}
	createTextNode(e) {
		this._assertAlive();
		let t = {
			kind: "text",
			id: oa(),
			text: String(e),
			instance: this.instance
		};
		return ea.set(t.id, t), N(this.instance, {
			t: "text",
			id: t.id,
			text: t.text
		}), la() !== this.instance && ma(), this._wrap(t);
	}
	adopt(e) {
		return this._assertAlive(), this._wrap(e);
	}
	createDocumentFragment() {
		return this._assertAlive(), new Ra(this, {
			kind: "element",
			id: ja(),
			type: "#fragment",
			instance: this.instance,
			props: {},
			listenerSlots: {}
		});
	}
	createComment(e = "") {
		let t = this.createTextNode(""), n = new La(this, t.instance);
		return n.instance.text = String(e), this._wrappers.set(t.instance.id, n), n;
	}
	importNode(e, t = !1) {
		return this._assertAlive(), e instanceof Fa || Ma(e), e.cloneNode(t);
	}
	baseURI = "about:blank";
	_wrap(e) {
		let t = this._wrappers.get(e.id);
		return t === void 0 && (t = e.kind === "text" ? new Ia(this, e) : new ms(this, e), this._wrappers.set(e.id, t)), t;
	}
	addEventListener(e, t, n) {
		this._assertAlive();
		let r = Ea(n);
		if (this._docListeners.some((n) => n.type === e && n.fn === t && n.capture === r.capture)) return;
		let i = ba((n) => {
			try {
				t.call(this, this._enrichEvent(n, this));
			} finally {
				r.once && this.removeEventListener(e, t, { capture: r.capture });
			}
		}, this.instance, 0);
		this._docListeners.push({
			type: e,
			fn: t,
			hid: i,
			capture: r.capture
		}), this._handlerIds.add(i), N(this.instance, {
			t: "listen",
			id: 0,
			type: e,
			handler: i,
			opts: Da(n)
		}), la() !== this.instance && ma();
	}
	removeEventListener(e, t, n) {
		this._assertAlive();
		let r = Ea(n).capture, i = this._docListeners.findIndex((n) => n.type === e && n.fn === t && n.capture === r);
		if (i === -1) return;
		let [a] = this._docListeners.splice(i, 1);
		xa(a.hid), this._handlerIds.delete(a.hid), N(this.instance, {
			t: "unlisten",
			id: 0,
			type: e,
			handler: a.hid,
			opts: a.capture ? { capture: !0 } : void 0
		}), la() !== this.instance && ma();
	}
	getElementById(e) {
		let t = this._ids.get(e);
		return t !== void 0 && t.isConnected ? t : null;
	}
	querySelector(e) {
		return this.querySelectorAll(e)[0] ?? null;
	}
	querySelectorAll(e) {
		let t = is(e), n = t[0];
		if ((n.tag === "body" || n.tag === "html") && n.id === void 0 && n.classes.length === 0 && n.attrs.length === 0 && (t = t.slice(1)), t.length === 0) return [this._root];
		let r = [], i = (e) => {
			for (let n of e._children) n instanceof ms && os(n, t) && r.push(n), i(n);
		};
		return i(this._root), r;
	}
	getComputedStyle(e) {
		return this._warn("getComputedStyle"), new Proxy({}, { get: (e, t) => t === "getPropertyValue" ? () => "" : "" });
	}
	dispose() {
		this._uninstallShim?.(), this._uninstallShim = null, this._disposed = !0, gs.get(this.instance) === this && gs.delete(this.instance), this._resizeHandlers.clear();
		for (let e of this._handlerIds) xa(e);
		this._handlerIds.clear();
	}
}, gs = /* @__PURE__ */ new Map(), _s = (e) => {
	let t = new hs(e);
	return gs.set(e, t), t;
}, vs = (e) => gs.get(e) ?? _s(e), ys = (e) => gs.get(e), bs = (e) => {
	gs.get(e)?.dispose();
}, xs = () => gs.get(la()), Ss = () => gs.size === 1 ? gs.values().next().value : gs.get(ua()), Cs = (e) => {
	let t = globalThis, n = /* @__PURE__ */ new Map(), r = (t) => {
		N(e.instance, t), la() !== e.instance && ma();
	}, i = (t, i, a) => {
		e._assertAlive();
		let o = Ea(a).capture, s = n.get(t), c = s?.findIndex((e) => e.fn === i && e.capture === o) ?? -1;
		if (c === -1 || s === void 0) return;
		let [l] = s.splice(c, 1);
		xa(l.hid), e._handlerIds.delete(l.hid), r({
			t: "unlisten",
			id: 0,
			type: t,
			handler: l.hid,
			opts: l.capture ? { capture: !0 } : void 0
		});
	}, a = (t, a, o) => {
		e._assertAlive();
		let s = Ea(o), c = n.get(t);
		if (c === void 0 && n.set(t, c = []), c.some((e) => e.fn === a && e.capture === s.capture)) return;
		let l = ba((n) => {
			try {
				a.call(h, e._enrichEvent(n, h));
			} finally {
				s.once && i(t, a, { capture: s.capture });
			}
		}, e.instance, 0);
		c.push({
			fn: a,
			hid: l,
			capture: s.capture
		}), e._handlerIds.add(l), r({
			t: "listen",
			id: 0,
			type: t,
			handler: l,
			opts: Da(o)
		});
	}, o = t.requestAnimationFrame, s = t.cancelAnimationFrame, c = t.setTimeout, l = t.setInterval, u = t.clearTimeout, d = t.clearInterval, f = /* @__PURE__ */ new Set(), p = /* @__PURE__ */ new Set(), m = /* @__PURE__ */ new Set(), h = {
		document: e,
		navigator: { userAgent: "atoll-islands" },
		location: {
			href: "about:blank",
			reload() {},
			assign(e) {},
			replace(e) {}
		},
		get innerWidth() {
			return va(e.instance)?.w ?? 0;
		},
		get innerHeight() {
			return va(e.instance)?.h ?? 0;
		},
		devicePixelRatio: 1,
		requestAnimationFrame(e) {
			let t, n = (n) => {
				m.delete(t), e(n);
			};
			return t = typeof o == "function" ? o.call(globalThis, n) : c((e) => n(e), 16, Date.now()), m.add(t), t;
		},
		cancelAnimationFrame(e) {
			e !== void 0 && (m.delete(e), typeof s == "function" ? s.call(globalThis, e) : u(e));
		},
		setTimeout(...e) {
			let [t, n, ...r] = e, i;
			return i = c((...e) => {
				f.delete(i), t(...e);
			}, n, ...r), f.add(i), i;
		},
		clearTimeout(e) {
			e !== void 0 && (f.delete(e), u(e));
		},
		setInterval(...e) {
			let [t, n, ...r] = e, i = l(t, n, ...r);
			return p.add(i), i;
		},
		clearInterval(e) {
			e !== void 0 && (p.delete(e), d(e));
		},
		getComputedStyle: () => ({}),
		matchMedia: (e) => ({
			matches: !1,
			media: e,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => !1
		}),
		addEventListener: a,
		removeEventListener: i,
		scrollTo: () => {},
		scrollBy: () => {},
		scroll: () => {}
	};
	return {
		facade: h,
		teardown: () => {
			for (let e of m) typeof s == "function" ? s.call(globalThis, e) : u(e);
			m.clear();
			for (let e of f) u(e);
			f.clear();
			for (let e of p) d(e);
			p.clear();
			for (let [t, r] of n) {
				for (let n of r) xa(n.hid), e._handlerIds.delete(n.hid), e._disposed || N(e.instance, {
					t: "unlisten",
					id: 0,
					type: t,
					handler: n.hid
				});
				r.length = 0;
			}
		}
	};
}, ws = (e) => (e._windowBundle === void 0 && (e._windowBundle = Cs(e)), e._windowBundle), Ts = !1, Es = class {}, Ds = {
	get: () => void 0,
	define: () => {},
	upgrade: () => {},
	whenDefined: () => new Promise(() => {})
};
function Os() {
	if (Ts) return;
	Ts = !0;
	let e = globalThis, t = e.document, n = e.window, r = e.Element, i = e.Node, a = e.Text, o = e.Comment, s = e.HTMLMediaElement, c = e.customElements, l, u, d;
	Object.defineProperty(e, "document", {
		configurable: !0,
		enumerable: !0,
		get: () => xs() ?? l ?? Ss() ?? t,
		set: (e) => {
			l = e;
		}
	}), Object.defineProperty(e, "window", {
		configurable: !0,
		enumerable: !0,
		get: () => {
			let e = xs();
			if (e !== void 0) return ws(e).facade;
			if (u !== void 0) return u;
			let t = Ss();
			return t === void 0 ? n : ws(t).facade;
		},
		set: (e) => {
			u = e;
		}
	}), Object.defineProperty(e, "Element", {
		configurable: !0,
		enumerable: !0,
		get: () => xs() === void 0 ? d === void 0 ? Ss() === void 0 ? r : ms : d : ms,
		set: (e) => {
			d = e;
		}
	});
	let f = (t, n, r) => {
		let i;
		Object.defineProperty(e, t, {
			configurable: !0,
			enumerable: !0,
			get: () => xs() === void 0 ? i === void 0 ? Ss() === void 0 ? r : n : i : n,
			set: (e) => {
				i = e;
			}
		});
	};
	f("Node", Fa, i), f("Text", Ia, a), f("Comment", La, o), f("HTMLMediaElement", typeof s == "function" ? s : Es, s), f("customElements", c === void 0 ? Ds : c, c);
}
//#endregion
//#region ../../packages/islands/src/worker/defineWorkers.ts
var ks = (e) => typeof e == "object" && !!e && "imperative" in e, As = (e) => typeof e == "object" && !!e && "mount" in e, js = (e) => (t) => (...n) => {
	N(e, {
		t: "emit",
		name: Wi,
		payload: {
			id: t,
			args: n
		}
	}), ma();
}, Ms = (e) => e.imperative !== void 0, Ns = (e) => e.rendered !== void 0, Ps = /* @__PURE__ */ new Map(), Fs = /* @__PURE__ */ new Map(), Is = (e, t) => {
	Fs.set(e, t);
}, Ls = (e) => Fs.get(e) ?? (Fs.size === 1 ? Fs.values().next().value : void 0), Rs = () => `w-${Math.random().toString(36).slice(2, 8)}`, zs = (e) => {
	let t = e.lastIndexOf("@"), n = t === -1 ? e : e.slice(0, t), r = n.lastIndexOf("~");
	return r === -1 ? n : n.slice(r + 1);
};
function Bs(e = Ui) {
	pa(e), Os();
	let t = (e, t, n) => {
		if (e?.props === void 0) return n;
		try {
			return e.props.parse(n);
		} catch (n) {
			throw Error(`[island "${e.app}"] props for "${t}" rejected by contract: ` + (n instanceof Error ? n.message : String(n)));
		}
	};
	function n(e, t) {
		let n = Ls(zs(e)), r = Bi(n);
		if (aa(e, r), As(n)) return {
			key: e,
			app: zs(e),
			pid: t,
			contract: r,
			rendered: {
				app: n,
				handle: void 0,
				props: {}
			}
		};
		if (ks(n)) return {
			key: e,
			app: zs(e),
			pid: t,
			contract: r,
			imperative: {
				build: n.imperative,
				dispose: n.dispose,
				doc: _s(e),
				props: {}
			}
		};
		throw Error(`createInstance: "${zs(e)}" is a bare component — registry values must be { imperative } or a framework adapter's RenderedIslandApp (reactIslandApp/vueIslandApp/…, or the package's define*PolyWorker which wraps for you)`);
	}
	function r(e, t) {
		return da(e.key, () => {
			let n = e.imperative;
			return n.dispose?.(n.doc), n.doc.dispose(), N(e.key, { t: "clear" }), n.doc = _s(e.key), n.props = t, n.build(n.doc, t), ha(e.key);
		});
	}
	function i(e, t) {
		return {
			instance: e,
			get doc() {
				return vs(e);
			},
			props: t
		};
	}
	function a(e, t) {
		return da(e.key, () => {
			let n = e.rendered;
			return n.handle?.dispose?.(), bs(e.key), N(e.key, { t: "clear" }), n.props = t, n.handle = n.app.mount(i(e.key, t)), ha(e.key);
		});
	}
	return ni({
		sharedMemory: e,
		methods: {
			async mount(e, o = {}) {
				o = qi(o, js(e));
				let s = Ls(zs(e));
				if (s === void 0) throw Error(`mount: unknown app "${e}" — registry has: ${[...Fs.keys()].join(", ")}`);
				o = t(Bi(s), e, o);
				let c = Ps.get(e);
				if (c !== void 0 && Ms(c)) return r(c, o);
				if (c !== void 0) return a(c, o);
				let l = n(e, Rs());
				if (Ps.set(e, l), Ms(l)) {
					let t = l.imperative;
					return t.props = o, da(e, () => (t.build(t.doc, o), ha(e)));
				}
				let u = l.rendered;
				return u.props = o, da(e, () => (u.handle = u.app.mount(i(e, o)), ha(e)));
			},
			updateProps(e, n) {
				n = qi(n, js(e));
				let i = Ps.get(e);
				if (i === void 0) throw Error(`updateProps: "${e}" is not mounted in this worker — mount() first`);
				if (n = t(i.contract, e, n), Ms(i)) return r(i, n);
				let o = i.rendered;
				return o.handle?.update === void 0 ? a(i, n) : da(e, () => (o.handle.update(n), o.props = n, ha(e)));
			},
			dispatch(e, t) {
				let n = ga(e);
				if (n === void 0) return [];
				let r = Ps.get(n.instance);
				if (r === void 0) return [];
				let i = t;
				if (i.target === void 0 || i.currentTarget === void 0) {
					let e = vs(r.key);
					if (i.target === void 0 && typeof i.targetId == "number") {
						let t = ea.get(i.targetId);
						t !== void 0 && (i.target = e.adopt(t));
					}
					i.currentTarget === void 0 && n.instanceId !== void 0 && (i.currentTarget = n.instanceId === 0 ? e._root : ea.get(n.instanceId) === void 0 ? void 0 : e.adopt(ea.get(n.instanceId)));
				}
				return da(r.key, () => {
					let e = Ns(r) ? r.rendered.handle?.sync : void 0;
					return e === void 0 ? n.fn(t) : e(() => n.fn(t)), ha(r.key);
				});
			},
			setSize(e, t, n) {
				ya(e, t, n);
				let r = Ps.get(e);
				if (r === void 0) return ha(e);
				let i = Ms(r) ? r.imperative.doc : ys(e);
				return i === void 0 ? ha(e) : da(r.key, () => (i._notifySize(t, n), ha(e)));
			},
			unmount(e) {
				let t = Ps.get(e);
				return t === void 0 ? [] : (Ps.delete(e), aa(e, void 0), da(e, () => {
					if (Ms(t)) {
						let e = t.imperative;
						e.dispose?.(e.doc), e.doc.dispose();
					} else t.rendered.handle?.dispose?.(), bs(e);
					return ha(e), [{ t: "clear" }];
				}));
			},
			flush(e) {
				let t = Ps.get(e);
				if (t === void 0) return [];
				if (Ms(t)) return ha(e);
				let n = t.rendered;
				return da(t.key, () => (n.handle?.flush?.(), ha(e)));
			},
			whoami(e) {
				return Ps.get(e)?.pid ?? "unmounted";
			},
			renderer(e) {
				let t = Ps.get(e);
				return t && Ns(t) && t.rendered.app.renderer || null;
			}
		}
	});
}
function Vs(e, t) {
	let n = e.islandAppName;
	return Is(typeof n == "string" && n !== "" ? n : "main", e), Bs(t?.sharedMemory);
}
//#endregion
//#region ../../packages/islands/src/ops.ts
var Hs = /* @__PURE__ */ o(((e) => {
	function t(e, t) {
		var n = e.length;
		e.push(t);
		a: for (; 0 < n;) {
			var r = n - 1 >>> 1, a = e[r];
			if (0 < i(a, t)) e[r] = t, e[n] = a, n = r;
			else break a;
		}
	}
	function n(e) {
		return e.length === 0 ? null : e[0];
	}
	function r(e) {
		if (e.length === 0) return null;
		var t = e[0], n = e.pop();
		if (n !== t) {
			e[0] = n;
			a: for (var r = 0, a = e.length, o = a >>> 1; r < o;) {
				var s = 2 * (r + 1) - 1, c = e[s], l = s + 1, u = e[l];
				if (0 > i(c, n)) l < a && 0 > i(u, c) ? (e[r] = u, e[l] = n, r = l) : (e[r] = c, e[s] = n, r = s);
				else if (l < a && 0 > i(u, n)) e[r] = u, e[l] = n, r = l;
				else break a;
			}
		}
		return t;
	}
	function i(e, t) {
		var n = e.sortIndex - t.sortIndex;
		return n === 0 ? e.id - t.id : n;
	}
	if (e.unstable_now = void 0, typeof performance == "object" && typeof performance.now == "function") {
		var a = performance;
		e.unstable_now = function() {
			return a.now();
		};
	} else {
		var o = Date, s = o.now();
		e.unstable_now = function() {
			return o.now() - s;
		};
	}
	var c = [], l = [], u = 1, d = null, f = 3, p = !1, m = !1, h = !1, g = !1, _ = typeof setTimeout == "function" ? setTimeout : null, v = typeof clearTimeout == "function" ? clearTimeout : null, y = typeof setImmediate < "u" ? setImmediate : null;
	function ee(e) {
		for (var i = n(l); i !== null;) {
			if (i.callback === null) r(l);
			else if (i.startTime <= e) r(l), i.sortIndex = i.expirationTime, t(c, i);
			else break;
			i = n(l);
		}
	}
	function te(e) {
		if (h = !1, ee(e), !m) {
			if (n(c) !== null) m = !0, b || (b = !0, ie());
			else {
				var t = n(l);
				t !== null && se(te, t.startTime - e);
			}
		}
	}
	var b = !1, x = -1, ne = 5, S = -1;
	function C() {
		return g ? !0 : !(e.unstable_now() - S < ne);
	}
	function re() {
		if (g = !1, b) {
			var t = e.unstable_now();
			S = t;
			var i = !0;
			try {
				a: {
					m = !1, h && (h = !1, v(x), x = -1), p = !0;
					var a = f;
					try {
						b: {
							for (ee(t), d = n(c); d !== null && !(d.expirationTime > t && C());) {
								var o = d.callback;
								if (typeof o == "function") {
									d.callback = null, f = d.priorityLevel;
									var s = o(d.expirationTime <= t);
									if (t = e.unstable_now(), typeof s == "function") {
										d.callback = s, ee(t), i = !0;
										break b;
									}
									d === n(c) && r(c), ee(t);
								} else r(c);
								d = n(c);
							}
							if (d !== null) i = !0;
							else {
								var u = n(l);
								u !== null && se(te, u.startTime - t), i = !1;
							}
						}
						break a;
					} finally {
						d = null, f = a, p = !1;
					}
					i = void 0;
				}
			} finally {
				i ? ie() : b = !1;
			}
		}
	}
	var ie;
	if (typeof y == "function") ie = function() {
		y(re);
	};
	else if (typeof MessageChannel < "u") {
		var ae = new MessageChannel(), oe = ae.port2;
		ae.port1.onmessage = re, ie = function() {
			oe.postMessage(null);
		};
	} else ie = function() {
		_(re, 0);
	};
	function se(t, n) {
		x = _(function() {
			t(e.unstable_now());
		}, n);
	}
	e.unstable_IdlePriority = 5, e.unstable_ImmediatePriority = 1, e.unstable_LowPriority = 4, e.unstable_NormalPriority = 3, e.unstable_Profiling = null, e.unstable_UserBlockingPriority = 2, e.unstable_cancelCallback = function(e) {
		e.callback = null;
	}, e.unstable_forceFrameRate = function(e) {
		0 > e || 125 < e ? console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported") : ne = 0 < e ? Math.floor(1e3 / e) : 5;
	}, e.unstable_getCurrentPriorityLevel = function() {
		return f;
	}, e.unstable_next = function(e) {
		switch (f) {
			case 1:
			case 2:
			case 3:
				var t = 3;
				break;
			default: t = f;
		}
		var n = f;
		f = t;
		try {
			return e();
		} finally {
			f = n;
		}
	}, e.unstable_requestPaint = function() {
		g = !0;
	}, e.unstable_runWithPriority = function(e, t) {
		switch (e) {
			case 1:
			case 2:
			case 3:
			case 4:
			case 5: break;
			default: e = 3;
		}
		var n = f;
		f = e;
		try {
			return t();
		} finally {
			f = n;
		}
	}, e.unstable_scheduleCallback = function(r, i, a) {
		var o = e.unstable_now();
		switch (typeof a == "object" && a ? (a = a.delay, a = typeof a == "number" && 0 < a ? o + a : o) : a = o, r) {
			case 1:
				var s = -1;
				break;
			case 2:
				s = 250;
				break;
			case 5:
				s = 1073741823;
				break;
			case 4:
				s = 1e4;
				break;
			default: s = 5e3;
		}
		return s = a + s, r = {
			id: u++,
			callback: i,
			priorityLevel: r,
			startTime: a,
			expirationTime: s,
			sortIndex: -1
		}, a > o ? (r.sortIndex = a, t(l, r), n(c) === null && r === n(l) && (h ? (v(x), x = -1) : h = !0, se(te, a - o))) : (r.sortIndex = s, t(c, r), m || p || (m = !0, b || (b = !0, ie()))), r;
	}, e.unstable_shouldYield = C, e.unstable_wrapCallback = function(e) {
		var t = f;
		return function() {
			var n = f;
			f = t;
			try {
				return e.apply(this, arguments);
			} finally {
				f = n;
			}
		};
	};
})), Us = /* @__PURE__ */ o(((e, t) => {
	t.exports = Hs();
})), Ws = /* @__PURE__ */ o(((e, t) => {
	t.exports = function(e) {
		function t(e, t, n, r) {
			return new co(e, t, n, r);
		}
		function n() {}
		function r(e) {
			var t = "https://react.dev/errors/" + e;
			if (1 < arguments.length) {
				t += "?args[]=" + encodeURIComponent(arguments[1]);
				for (var n = 2; n < arguments.length; n++) t += "&args[]=" + encodeURIComponent(arguments[n]);
			}
			return "Minified React error #" + e + "; visit " + t + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
		}
		function i(e) {
			for (var t = e, n = t; n && !n.alternate;) t = n, t.flags & 4098 && (e = t.return), n = t.return;
			for (; t.return;) t = t.return;
			return t.tag === 3 ? e : null;
		}
		function a(e) {
			if (i(e) !== e) throw Error(r(188));
		}
		function o(e) {
			var t = e.alternate;
			if (!t) {
				if (t = i(e), t === null) throw Error(r(188));
				return t === e ? e : null;
			}
			for (var n = e, o = t;;) {
				var s = n.return;
				if (s === null) break;
				var c = s.alternate;
				if (c === null) {
					if (o = s.return, o !== null) {
						n = o;
						continue;
					}
					break;
				}
				if (s.child === c.child) {
					for (c = s.child; c;) {
						if (c === n) return a(s), e;
						if (c === o) return a(s), t;
						c = c.sibling;
					}
					throw Error(r(188));
				}
				if (n.return !== o.return) n = s, o = c;
				else {
					for (var l = !1, u = s.child; u;) {
						if (u === n) {
							l = !0, n = s, o = c;
							break;
						}
						if (u === o) {
							l = !0, o = s, n = c;
							break;
						}
						u = u.sibling;
					}
					if (!l) {
						for (u = c.child; u;) {
							if (u === n) {
								l = !0, n = c, o = s;
								break;
							}
							if (u === o) {
								l = !0, o = c, n = s;
								break;
							}
							u = u.sibling;
						}
						if (!l) throw Error(r(189));
					}
				}
				if (n.alternate !== o) throw Error(r(190));
			}
			if (n.tag !== 3) throw Error(r(188));
			return n.stateNode.current === n ? e : t;
		}
		function s(e) {
			var t = e.tag;
			if (t === 5 || t === 26 || t === 27 || t === 6) return e;
			for (e = e.child; e !== null;) {
				if (t = s(e), t !== null) return t;
				e = e.sibling;
			}
			return null;
		}
		function c(e) {
			var t = e.tag;
			if (t === 5 || t === 26 || t === 27 || t === 6) return e;
			for (e = e.child; e !== null;) {
				if (e.tag !== 4 && (t = c(e), t !== null)) return t;
				e = e.sibling;
			}
			return null;
		}
		function l(e) {
			return typeof e != "object" || !e ? null : (e = Wo && e[Wo] || e["@@iterator"], typeof e == "function" ? e : null);
		}
		function d(e) {
			if (e == null) return null;
			if (typeof e == "function") return e.$$typeof === Ko ? null : e.displayName || e.name || null;
			if (typeof e == "string") return e;
			switch (e) {
				case ko: return "Fragment";
				case jo: return "Profiler";
				case Ao: return "StrictMode";
				case Fo: return "Suspense";
				case Io: return "SuspenseList";
				case zo: return "Activity";
				case Ho: return "ViewTransition";
			}
			if (typeof e == "object") switch (e.$$typeof) {
				case Oo: return "Portal";
				case No: return e.displayName || "Context";
				case Mo: return (e._context.displayName || "Context") + ".Consumer";
				case Po:
					var t = e.render;
					return e = e.displayName, e ||= (e = t.displayName || t.name || "", e === "" ? "ForwardRef" : "ForwardRef(" + e + ")"), e;
				case Lo: return t = e.displayName || null, t === null ? d(e.type) || "Memo" : t;
				case Ro:
					t = e._payload, e = e._init;
					try {
						return d(e(t));
					} catch {}
			}
			return null;
		}
		function f(e) {
			return { current: e };
		}
		function p(e) {
			0 > Ol || (e.current = Dl[Ol], Dl[Ol] = null, Ol--);
		}
		function m(e, t) {
			Ol++, Dl[Ol] = e.current, e.current = t;
		}
		function h(e) {
			return e >>>= 0, e === 0 ? 32 : 31 - (jl(e) / Ml | 0) | 0;
		}
		function g(e) {
			var t = e & 42;
			if (t !== 0) return t;
			switch (e & -e) {
				case 1: return 1;
				case 2: return 2;
				case 4: return 4;
				case 8: return 8;
				case 16: return 16;
				case 32: return 32;
				case 64: return 64;
				case 128: return 128;
				case 256:
				case 512:
				case 1024:
				case 2048:
				case 4096:
				case 8192:
				case 16384:
				case 32768:
				case 65536:
				case 131072: return e & -e;
				case 262144:
				case 524288:
				case 1048576:
				case 2097152: return e & 3932160;
				case 4194304:
				case 8388608:
				case 16777216:
				case 33554432: return e & 62914560;
				case 67108864: return 67108864;
				case 134217728: return 134217728;
				case 268435456: return 268435456;
				case 536870912: return 536870912;
				case 1073741824: return 0;
				default: return e;
			}
		}
		function _(e, t, n) {
			var r = e.pendingLanes;
			if (r === 0) return 0;
			var i = 0, a = e.suspendedLanes, o = e.pingedLanes;
			e = e.warmLanes;
			var s = r & 134217727;
			return s === 0 ? (s = r & ~a, s === 0 ? o === 0 ? n || (n = r & ~e, n !== 0 && (i = g(n))) : i = g(o) : i = g(s)) : (r = s & ~a, r === 0 ? (o &= s, o === 0 ? n || (n = s & ~e, n !== 0 && (i = g(n))) : i = g(o)) : i = g(r)), i === 0 ? 0 : t !== 0 && t !== i && (t & a) === 0 && (a = i & -i, n = t & -t, a >= n || a === 32 && n & 4194048) ? t : i;
		}
		function v(e, t) {
			return (e.pendingLanes & ~(e.suspendedLanes & ~e.pingedLanes) & t) === 0;
		}
		function y(e, t) {
			t & 8 && (t |= t & 32);
			var n = e.entangledLanes;
			if (n !== 0) for (e = e.entanglements, n &= t; 0 < n;) {
				var r = 31 - Al(n), i = 1 << r;
				t |= e[r], n &= ~i;
			}
			return t;
		}
		function ee(e, t) {
			switch (e) {
				case 1:
				case 2:
				case 4:
				case 8:
				case 64: return t + 250;
				case 16:
				case 32:
				case 128:
				case 256:
				case 512:
				case 1024:
				case 2048:
				case 4096:
				case 8192:
				case 16384:
				case 32768:
				case 65536:
				case 131072:
				case 262144:
				case 524288:
				case 1048576:
				case 2097152: return t + 5e3;
				case 4194304:
				case 8388608:
				case 16777216:
				case 33554432: return -1;
				case 67108864:
				case 134217728:
				case 268435456:
				case 536870912:
				case 1073741824: return -1;
				default: return -1;
			}
		}
		function te() {
			var e = Fl;
			return Fl <<= 1, !(Fl & 62914560) && (Fl = 4194304), e;
		}
		function b(e) {
			for (var t = [], n = 0; 31 > n; n++) t.push(e);
			return t;
		}
		function x(e, t) {
			e.pendingLanes |= t, t !== 268435456 && (e.suspendedLanes = 0, e.pingedLanes = 0, e.warmLanes = 0);
		}
		function ne(e, t, n, r, i, a) {
			var o = e.pendingLanes;
			e.pendingLanes = n, e.suspendedLanes = 0, e.pingedLanes = 0, e.warmLanes = 0, e.expiredLanes &= n, e.entangledLanes &= n, e.errorRecoveryDisabledLanes &= n, e.shellSuspendCounter = 0;
			var s = e.entanglements, c = e.expirationTimes, l = e.hiddenUpdates;
			for (n = o & ~n; 0 < n;) {
				var u = 31 - Al(n), d = 1 << u;
				s[u] = 0, c[u] = -1;
				var f = l[u];
				if (f !== null) for (l[u] = null, u = 0; u < f.length; u++) {
					var p = f[u];
					p !== null && (p.lane &= -536870913);
				}
				n &= ~d;
			}
			r !== 0 && S(e, r, 0), a !== 0 && i === 0 && e.tag !== 0 && (e.suspendedLanes |= a & ~(o & ~t));
		}
		function S(e, t, n) {
			e.pendingLanes |= t, e.suspendedLanes &= ~t;
			var r = 31 - Al(t);
			e.entangledLanes |= t, e.entanglements[r] = e.entanglements[r] | 1073741824 | n & 261930;
		}
		function C(e, t) {
			var n = e.entangledLanes |= t;
			for (e = e.entanglements; n;) {
				var r = 31 - Al(n), i = 1 << r;
				i & t | e[r] & t && (e[r] |= t), n &= ~i;
			}
		}
		function re(e, t) {
			var n = t & -t;
			return n = n & 42 ? 1 : ie(n), (n & (e.suspendedLanes | t)) === 0 ? n : 0;
		}
		function ie(e) {
			switch (e) {
				case 2:
					e = 1;
					break;
				case 8:
					e = 4;
					break;
				case 32:
					e = 16;
					break;
				case 256:
				case 512:
				case 1024:
				case 2048:
				case 4096:
				case 8192:
				case 16384:
				case 32768:
				case 65536:
				case 131072:
				case 262144:
				case 524288:
				case 1048576:
				case 2097152:
				case 4194304:
				case 8388608:
				case 16777216:
				case 33554432:
					e = 128;
					break;
				case 268435456:
					e = 134217728;
					break;
				default: e = 0;
			}
			return e;
		}
		function ae(e) {
			return e &= -e, 2 < e ? 8 < e ? e & 134217727 ? 32 : 268435456 : 8 : 2;
		}
		function oe(e) {
			if (typeof Gl == "function" && Kl(e), Jl && typeof Jl.setStrictMode == "function") try {
				Jl.setStrictMode(ql, e);
			} catch {}
		}
		function se(e, t) {
			if (e.name != null && e.name !== "auto") return e.name;
			if (t.autoName !== null) return t.autoName;
			e = gf.identifierPrefix;
			var n = Yl++;
			return e = "_" + e + "t_" + n.toString(32) + "_", t.autoName = e;
		}
		function ce(e) {
			if (e == null || typeof e == "string") return e;
			var t = null, n = wf;
			if (n !== null) for (var r = 0; r < n.length; r++) {
				var i = e[n[r]];
				if (i != null) {
					if (i === "none") return "none";
					t = t == null ? i : t + (" " + i);
				}
			}
			return t ?? e.default;
		}
		function le(e, t) {
			return e = ce(e), t = ce(t), t == null ? e === "auto" ? null : e : t === "auto" ? null : t;
		}
		function ue(e, t) {
			return e === t && (e !== 0 || 1 / e == 1 / t) || e !== e && t !== t;
		}
		function w(e) {
			if ($l === void 0) try {
				throw Error();
			} catch (e) {
				var t = e.stack.trim().match(/\n( *(at )?)/);
				$l = t && t[1] || "", eu = -1 < e.stack.indexOf("\n    at") ? " (<anonymous>)" : -1 < e.stack.indexOf("@") ? "@unknown:0:0" : "";
			}
			return "\n" + $l + e + eu;
		}
		function de(e, t) {
			if (!e || tu) return "";
			tu = !0;
			var n = Error.prepareStackTrace;
			Error.prepareStackTrace = void 0;
			try {
				var r = { DetermineComponentFrameRoot: function() {
					try {
						if (t) {
							var n = function() {
								throw Error();
							};
							if (Object.defineProperty(n.prototype, "props", { set: function() {
								throw Error();
							} }), typeof Reflect == "object" && Reflect.construct) {
								try {
									Reflect.construct(n, []);
								} catch (e) {
									var r = e;
								}
								Reflect.construct(e, [], n);
							} else {
								try {
									n.call();
								} catch (e) {
									r = e;
								}
								n = !1;
								try {
									var i = Object.getOwnPropertyDescriptor(e.prototype, "props");
									Object.defineProperty(e.prototype, "props", {
										configurable: !0,
										set: function() {
											throw Error();
										}
									}), n = !0, new e();
								} finally {
									n && (i === void 0 ? delete e.prototype.props : Object.defineProperty(e.prototype, "props", i));
								}
							}
						} else {
							try {
								throw Error();
							} catch (e) {
								r = e;
							}
							(n = e()) && typeof n.catch == "function" && n.catch(function() {});
						}
					} catch (e) {
						if (e && r && typeof e.stack == "string") return [e.stack, r.stack];
					}
					return [null, null];
				} };
				r.DetermineComponentFrameRoot.displayName = "DetermineComponentFrameRoot";
				var i = Object.getOwnPropertyDescriptor(r.DetermineComponentFrameRoot, "name");
				i && i.configurable && Object.defineProperty(r.DetermineComponentFrameRoot, "name", { value: "DetermineComponentFrameRoot" });
				var a = r.DetermineComponentFrameRoot(), o = a[0], s = a[1];
				if (o && s) {
					var c = o.split("\n"), l = s.split("\n");
					for (i = r = 0; r < c.length && !c[r].includes("DetermineComponentFrameRoot");) r++;
					for (; i < l.length && !l[i].includes("DetermineComponentFrameRoot");) i++;
					if (r === c.length || i === l.length) for (r = c.length - 1, i = l.length - 1; 1 <= r && 0 <= i && c[r] !== l[i];) i--;
					for (; 1 <= r && 0 <= i; r--, i--) if (c[r] !== l[i]) {
						if (r !== 1 || i !== 1) do
							if (r--, i--, 0 > i || c[r] !== l[i]) {
								var u = "\n" + c[r].replace(" at new ", " at ");
								return e.displayName && u.includes("<anonymous>") && (u = u.replace("<anonymous>", e.displayName)), u;
							}
						while (1 <= r && 0 <= i);
						break;
					}
				}
			} finally {
				tu = !1, Error.prepareStackTrace = n;
			}
			return (n = e ? e.displayName || e.name : "") ? w(n) : "";
		}
		function fe(e, t) {
			switch (e.tag) {
				case 26:
				case 27:
				case 5: return w(e.type);
				case 16: return w("Lazy");
				case 13: return e.child !== t && t !== null ? w("Suspense Fallback") : w("Suspense");
				case 19: return w("SuspenseList");
				case 0:
				case 15: return de(e.type, !1);
				case 11: return de(e.type.render, !1);
				case 1: return de(e.type, !0);
				case 31: return w("Activity");
				case 30: return w("ViewTransition");
				default: return "";
			}
		}
		function pe(e) {
			try {
				var t = "", n = null;
				do
					t += fe(e, n), n = e, e = e.return;
				while (e);
				return t;
			} catch (e) {
				return "\nError generating stack: " + e.message + "\n" + e.stack;
			}
		}
		function me(e, t) {
			if (typeof e == "object" && e) {
				var n = nu.get(e);
				return n === void 0 ? (t = {
					value: e,
					source: t,
					stack: pe(t)
				}, nu.set(e, t), t) : n;
			}
			return {
				value: e,
				source: t,
				stack: pe(t)
			};
		}
		function he(e, t) {
			ru[iu++] = ou, ru[iu++] = au, au = e, ou = t;
		}
		function ge(e, t, n) {
			su[cu++] = uu, su[cu++] = du, su[cu++] = lu, lu = e;
			var r = uu;
			e = du;
			var i = 32 - Al(r) - 1;
			r &= ~(1 << i), n += 1;
			var a = 32 - Al(t) + i;
			if (30 < a) {
				var o = i - i % 5;
				a = (r & (1 << o) - 1).toString(32), r >>= o, i -= o, uu = 1 << 32 - Al(t) + i | n << i | r, du = a + e;
			} else uu = 1 << a | n << i | r, du = e;
		}
		function _e(e) {
			e.return !== null && (he(e, 1), ge(e, 1, 0));
		}
		function ve(e) {
			for (; e === au;) au = ru[--iu], ru[iu] = null, ou = ru[--iu], ru[iu] = null;
			for (; e === lu;) lu = su[--cu], su[cu] = null, du = su[--cu], su[cu] = null, uu = su[--cu], su[cu] = null;
		}
		function ye(e, t) {
			su[cu++] = uu, su[cu++] = du, su[cu++] = lu, uu = t.id, du = t.overflow, lu = e;
		}
		function be(e, t) {
			m(mu, t), m(pu, e), m(fu, null), e = Qo(t), p(fu), m(fu, e);
		}
		function xe() {
			p(fu), p(pu), p(mu);
		}
		function Se(e) {
			var t = e.memoizedState;
			t !== null && (t = t.memoizedState, us ? ks._currentValue = t : ks._currentValue2 = t, m(hu, e)), t = fu.current;
			var n = $o(t, e.type);
			t !== n && (m(pu, e), m(fu, n));
		}
		function Ce(e) {
			pu.current === e && (p(fu), p(pu)), hu.current === e && (p(hu), us ? ks._currentValue = Os : ks._currentValue2 = Os);
		}
		function we(e) {
			throw Ae(me(Error(r(418, 1 < arguments.length && arguments[1] !== void 0 && arguments[1] ? "text" : "HTML", "")), e)), bu;
		}
		function Te(e, t) {
			if (!fs) throw Error(r(175));
			Hc(e.stateNode, e.type, e.memoizedProps, t, e) || we(e, !0);
		}
		function Ee(e) {
			for (gu = e.return; gu;) switch (gu.tag) {
				case 5:
				case 31:
				case 13:
					yu = !1;
					return;
				case 27:
				case 3:
					yu = !0;
					return;
				default: gu = gu.return;
			}
		}
		function De(e) {
			if (!fs || e !== gu) return !1;
			if (!G) return Ee(e), G = !0, !1;
			var t = e.tag;
			if (xl ? t !== 3 && t !== 27 && (t !== 5 || il(e.type) && !as(e.type, e.memoizedProps)) && _u && we(e) : t !== 3 && (t !== 5 || il(e.type) && !as(e.type, e.memoizedProps)) && _u && we(e), Ee(e), t === 13) {
				if (!fs) throw Error(r(316));
				if (e = e.memoizedState, e = e === null ? null : e.dehydrated, !e) throw Error(r(317));
				_u = qc(e);
			} else if (t === 31) {
				if (e = e.memoizedState, e = e === null ? null : e.dehydrated, !e) throw Error(r(317));
				_u = Kc(e);
			} else _u = xl && t === 27 ? Mc(e.type, _u) : gu ? jc(e.stateNode) : null;
			return !0;
		}
		function Oe() {
			fs && (_u = gu = null, G = !1);
		}
		function ke() {
			var e = vu;
			return e !== null && (cf === null ? cf = e : cf.push.apply(cf, e), vu = null), e;
		}
		function Ae(e) {
			vu === null ? vu = [e] : vu.push(e);
		}
		function je(e, t, n) {
			us ? (m(xu, t._currentValue), t._currentValue = n) : (m(xu, t._currentValue2), t._currentValue2 = n);
		}
		function Me(e) {
			var t = xu.current;
			us ? e._currentValue = t : e._currentValue2 = t, p(xu);
		}
		function Ne(e, t, n) {
			for (; e !== null;) {
				var r = e.alternate;
				if ((e.childLanes & t) === t ? r !== null && (r.childLanes & t) !== t && (r.childLanes |= t) : (e.childLanes |= t, r !== null && (r.childLanes |= t)), e === n) break;
				e = e.return;
			}
		}
		function Pe(e, t, n, i) {
			var a = e.child;
			for (a !== null && (a.return = e); a !== null;) {
				var o = a.dependencies;
				if (o !== null) {
					var s = a.child;
					o = o.firstContext;
					a: for (; o !== null;) {
						var c = o;
						o = a;
						for (var l = 0; l < t.length; l++) if (c.context === t[l]) {
							o.lanes |= n, c = o.alternate, c !== null && (c.lanes |= n), Ne(o.return, n, e), i || (s = null);
							break a;
						}
						o = c.next;
					}
				} else if (a.tag === 18) {
					if (s = a.return, s === null) throw Error(r(341));
					s.lanes |= n, o = s.alternate, o !== null && (o.lanes |= n), Ne(s, n, e), s = null;
				} else a.tag === 13 && a.memoizedState !== null && a.memoizedState.dehydrated === null ? (a.lanes |= n, s = a.alternate, s !== null && (s.lanes |= n), Ne(a.return, n, e), s = a.child, s = s === null ? null : s.sibling) : s = a.child;
				if (s !== null) s.return = a;
				else for (s = a; s !== null;) {
					if (s === e) {
						s = null;
						break;
					}
					if (a = s.sibling, a !== null) {
						a.return = s.return, s = a;
						break;
					}
					s = s.return;
				}
				a = s;
			}
		}
		function Fe(e, t, n, i) {
			e = null;
			for (var a = t, o = !1; a !== null;) {
				if (!o) {
					if (a.flags & 524288) o = !0;
					else if (a.flags & 262144) break;
				}
				if (a.tag === 10) {
					var s = a.alternate;
					if (s === null) throw Error(r(387));
					if (s = s.memoizedProps, s !== null) {
						var c = a.type;
						Xl(a.pendingProps.value, s.value) || (e === null ? e = [c] : e.push(c));
					}
				} else if (a === hu.current) {
					if (s = a.alternate, s === null) throw Error(r(387));
					s.memoizedState.memoizedState !== a.memoizedState.memoizedState && (e === null ? e = [ks] : e.push(ks));
				}
				a = a.return;
			}
			return e !== null && Pe(t, e, n, i), t.flags |= 262144, e !== null;
		}
		function Ie(e) {
			for (e = e.firstContext; e !== null;) {
				var t = e.context;
				if (!Xl(us ? t._currentValue : t._currentValue2, e.memoizedValue)) return !0;
				e = e.next;
			}
			return !1;
		}
		function Le(e) {
			Su = e, Cu = null, e = e.dependencies, e !== null && (e.firstContext = null);
		}
		function Re(e) {
			return Be(Su, e);
		}
		function ze(e, t) {
			return Su === null && Le(e), Be(e, t);
		}
		function Be(e, t) {
			var n = us ? t._currentValue : t._currentValue2;
			if (t = {
				context: t,
				memoizedValue: n,
				next: null
			}, Cu === null) {
				if (e === null) throw Error(r(308));
				Cu = t, e.dependencies = {
					lanes: 0,
					firstContext: t
				}, e.flags |= 524288;
			} else Cu = Cu.next = t;
			return n;
		}
		function Ve() {
			return {
				controller: new wu(),
				data: /* @__PURE__ */ new Map(),
				refCount: 0
			};
		}
		function He(e) {
			e.refCount--, e.refCount === 0 && Tu(Eu, function() {
				e.controller.abort();
			});
		}
		function Ue(e, t) {
			if (e.pendingLanes & 4194048) {
				var n = e.transitionTypes;
				for (n === null && (n = e.transitionTypes = []), e = 0; e < t.length; e++) {
					var r = t[e];
					n.indexOf(r) === -1 && n.push(r);
				}
			}
		}
		function We(e) {
			var t = e.transitionTypes;
			return e.transitionTypes = null, t;
		}
		function Ge() {}
		function Ke(e) {
			e !== Au && e.next === null && (Au === null ? ku = Au = e : Au = Au.next = e), Mu = !0, ju || (ju = !0, Xe());
		}
		function qe(e, t) {
			if (!Nu && Mu) {
				Nu = !0;
				do
					for (var n = !1, r = ku; r !== null;) {
						if (!t) {
							if (e !== 0) {
								var i = r.pendingLanes;
								if (i === 0) var a = 0;
								else {
									var o = r.suspendedLanes, s = r.pingedLanes;
									a = (1 << 31 - Al(42 | e) + 1) - 1, a &= i & ~(o & ~s), a = a & 201326741 ? a & 201326741 | 1 : a ? a | 2 : 0;
								}
								a !== 0 && (n = !0, D(r, a));
							} else a = Q, a = _(r, r === X ? a : 0, r.cancelPendingCommit !== null || r.timeoutHandle !== ls), !(a & 3) || v(r, a) || (n = !0, D(r, a));
						}
						r = r.next;
					}
				while (n);
				Nu = !1;
			}
		}
		function Je() {
			T();
		}
		function T() {
			Mu = ju = !1;
			var e = 0;
			Pu !== 0 && vs() && (e = Pu);
			for (var t = Bl(), n = null, r = ku; r !== null;) {
				var i = r.next, a = Ye(r, t);
				a === 0 ? (r.next = null, n === null ? ku = i : n.next = i, i === null && (Au = n)) : (n = r, (e !== 0 || a & 3) && (Mu = !0)), r = i;
			}
			hf !== 0 && hf !== 5 || qe(e, !1), Pu !== 0 && (Pu = 0);
		}
		function Ye(e, t) {
			for (var n = e.suspendedLanes, r = e.pingedLanes, i = e.expirationTimes, a = e.pendingLanes & -62914561; 0 < a;) {
				var o = 31 - Al(a), s = 1 << o, c = i[o];
				c === -1 ? ((s & n) === 0 || (s & r) !== 0) && (i[o] = ee(s, t)) : c <= t && (e.expiredLanes |= s), a &= ~s;
			}
			if (t = X, n = Q, n = _(e, e === t ? n : 0, e.cancelPendingCommit !== null || e.timeoutHandle !== ls), r = e.callbackNode, n === 0 || e === t && ($ === 2 || $ === 9) || e.cancelPendingCommit !== null) return r !== null && r !== null && Ll(r), e.callbackNode = null, e.callbackPriority = 0;
			if (!(n & 3) || v(e, n)) {
				if (t = n & -n, t === e.callbackPriority) return t;
				switch (r !== null && Ll(r), ae(n)) {
					case 2:
					case 8:
						n = Hl;
						break;
					case 32:
						n = Ul;
						break;
					case 268435456:
						n = Wl;
						break;
					default: n = Ul;
				}
				return r = E.bind(null, e), n = Il(n, r), e.callbackPriority = t, e.callbackNode = n, t;
			}
			return r !== null && r !== null && Ll(r), e.callbackPriority = 2, e.callbackNode = null, 2;
		}
		function E(e, t) {
			if (hf !== 0 && hf !== 5) return e.callbackNode = null, e.callbackPriority = 0, null;
			var n = e.callbackNode;
			if (to() && e.callbackNode !== n) return null;
			var r = Q;
			return r = _(e, e === X ? r : 0, e.cancelPendingCommit !== null || e.timeoutHandle !== ls), r === 0 ? null : (Ea(e, r, t), Ye(e, Bl()), e.callbackNode != null && e.callbackNode === n ? E.bind(null, e) : null);
		}
		function D(e, t) {
			if (to()) return null;
			Ea(e, t, !0);
		}
		function Xe() {
			js ? Ms(function() {
				Y & 6 ? Il(Vl, Je) : T();
			}) : Il(Vl, Je);
		}
		function O() {
			if (Pu === 0) {
				var e = Lu;
				e === 0 && (e = Nl, Nl <<= 1, !(Nl & 261888) && (Nl = 256)), Pu = e;
			}
			return Pu;
		}
		function Ze(e, t) {
			if (Fu === null) {
				var n = Fu = [];
				Iu = 0, Lu = O(), Ru = {
					status: "pending",
					value: void 0,
					then: function(e) {
						n.push(e);
					}
				};
			}
			return Iu++, t.then(Qe, Qe), t;
		}
		function Qe() {
			if (--Iu === 0 && (Ou = null, Fu !== null)) {
				Ru !== null && (Ru.status = "fulfilled");
				var e = Fu;
				Fu = null, Lu = 0, Ru = null;
				for (var t = 0; t < e.length; t++) (0, e[t])();
			}
		}
		function $e(e, t) {
			var n = [], r = {
				status: "pending",
				value: null,
				reason: null,
				then: function(e) {
					n.push(e);
				}
			};
			return e.then(function() {
				r.status = "fulfilled", r.value = t;
				for (var e = 0; e < n.length; e++) (0, n[e])(t);
			}, function(e) {
				for (r.status = "rejected", r.reason = e, e = 0; e < n.length; e++) (0, n[e])(void 0);
			}), r;
		}
		function et() {
			var e = Bu.current;
			return e === null ? X.pooledCache : e;
		}
		function tt(e, t) {
			t === null ? m(Bu, Bu.current) : m(Bu, t.pool);
		}
		function nt() {
			var e = et();
			return e === null ? null : {
				parent: us ? Du._currentValue : Du._currentValue2,
				pool: e
			};
		}
		function rt(e, t) {
			if (Xl(e, t)) return !0;
			if (typeof e != "object" || !e || typeof t != "object" || !t) return !1;
			var n = Object.keys(e), r = Object.keys(t);
			if (n.length !== r.length) return !1;
			for (r = 0; r < n.length; r++) {
				var i = n[r];
				if (!Ql.call(t, i) || !Xl(e[i], t[i])) return !1;
			}
			return !0;
		}
		function it(e) {
			return e = e.status, e === "fulfilled" || e === "rejected";
		}
		function at(e, t, n) {
			switch (n = e[n], n === void 0 ? e.push(t) : n !== t && (t.then(Ge, Ge), t = n), t.status) {
				case "fulfilled": return t.value;
				case "rejected": throw e = t.reason, ct(e), e === void 0 && !("reason" in t) ? Error(r(600)) : e;
				default:
					if (typeof t.status == "string") t.then(Ge, Ge);
					else {
						if (e = X, e !== null && 100 < e.shellSuspendCounter) throw Error(r(482));
						e = t, e.status = "pending", e.then(function(e) {
							if (t.status === "pending") {
								var n = t;
								n.status = "fulfilled", n.value = e;
							}
						}, function(e) {
							if (t.status === "pending") {
								var n = t;
								n.status = "rejected", n.reason = e;
							}
						});
					}
					switch (t.status) {
						case "fulfilled": return t.value;
						case "rejected": throw e = t.reason, ct(e), e;
					}
					throw Gu = t, Vu;
			}
		}
		function ot(e) {
			try {
				var t = e._init;
				return t(e._payload);
			} catch (e) {
				throw typeof e == "object" && e && typeof e.then == "function" ? (Gu = e, Vu) : e;
			}
		}
		function st() {
			if (Gu === null) throw Error(r(459));
			var e = Gu;
			return Gu = null, e;
		}
		function ct(e) {
			if (e === Vu || e === Uu) throw Error(r(483));
		}
		function lt(e) {
			var t = qu;
			return qu += 1, Ku === null && (Ku = []), at(Ku, e, t);
		}
		function ut(e, t) {
			t = t.props.ref, e.ref = t === void 0 ? null : t;
		}
		function dt(e, t) {
			throw t.$$typeof === Eo ? Error(r(525)) : (e = Object.prototype.toString.call(t), Error(r(31, e === "[object Object]" ? "object with keys {" + Object.keys(t).join(", ") + "}" : e)));
		}
		function ft(e) {
			function n(t, n) {
				if (e) {
					var r = t.deletions;
					r === null ? (t.deletions = [n], t.flags |= 16) : r.push(n);
				}
			}
			function i(t, r) {
				if (!e) return null;
				for (; r !== null;) n(t, r), r = r.sibling;
				return null;
			}
			function a(e) {
				for (var t = /* @__PURE__ */ new Map(); e !== null;) e.key === null ? t.set(e.index, e) : t.set(e.key, e), e = e.sibling;
				return t;
			}
			function o(e, t) {
				return e = uo(e, t), e.index = 0, e.sibling = null, e;
			}
			function s(t, n, r) {
				return t.index = r, e ? (r = t.alternate, r === null ? (t.flags |= 134217730, n) : (r = r.index, r < n ? (t.flags |= 2, n) : r)) : (t.flags |= 1048576, n);
			}
			function c(t) {
				return e && t.alternate === null && (t.flags |= 134217730), t;
			}
			function u(e, t, n, r) {
				return t === null || t.tag !== 6 ? (t = mo(n, e.mode, r), t.return = e, t) : (t = o(t, n), t.return = e, t);
			}
			function d(e, t, n, r) {
				var i = n.type;
				return i === ko ? (e = p(e, t, n.props.children, r, n.key), ut(e, n), e) : t !== null && (t.elementType === i || typeof i == "object" && i && i.$$typeof === Ro && ot(i) === t.type) ? (t = o(t, n.props), ut(t, n), t.return = e, t) : (t = L(n.type, n.key, n.props, null, e.mode, r), ut(t, n), t.return = e, t);
			}
			function f(e, t, n, r) {
				return t === null || t.tag !== 4 || t.stateNode.containerInfo !== n.containerInfo || t.stateNode.implementation !== n.implementation ? (t = go(n, e.mode, r), t.return = e, t) : (t = o(t, n.children || []), t.return = e, t);
			}
			function p(e, t, n, r, i) {
				return t === null || t.tag !== 7 ? (t = po(n, e.mode, r, i), t.return = e, t) : (t = o(t, n), t.return = e, t);
			}
			function m(e, t, n) {
				if (typeof t == "string" && t !== "" || typeof t == "number" || typeof t == "bigint") return t = mo("" + t, e.mode, n), t.return = e, t;
				if (typeof t == "object" && t) {
					switch (t.$$typeof) {
						case Do: return n = L(t.type, t.key, t.props, null, e.mode, n), ut(n, t), n.return = e, n;
						case Oo: return t = go(t, e.mode, n), t.return = e, t;
						case Ro: return t = ot(t), m(e, t, n);
					}
					if (qo(t) || l(t)) return t = po(t, e.mode, n, null), t.return = e, t;
					if (typeof t.then == "function") return m(e, lt(t), n);
					if (t.$$typeof === No) return m(e, ze(e, t), n);
					dt(e, t);
				}
				return null;
			}
			function h(e, t, n, r) {
				var i = t === null ? null : t.key;
				if (typeof n == "string" && n !== "" || typeof n == "number" || typeof n == "bigint") return i === null ? u(e, t, "" + n, r) : null;
				if (typeof n == "object" && n) {
					switch (n.$$typeof) {
						case Do: return n.key === i ? d(e, t, n, r) : null;
						case Oo: return n.key === i ? f(e, t, n, r) : null;
						case Ro: return n = ot(n), h(e, t, n, r);
					}
					if (qo(n) || l(n)) return i === null ? p(e, t, n, r, null) : null;
					if (typeof n.then == "function") return h(e, t, lt(n), r);
					if (n.$$typeof === No) return h(e, t, ze(e, n), r);
					dt(e, n);
				}
				return null;
			}
			function g(e, t, n, r, i) {
				if (typeof r == "string" && r !== "" || typeof r == "number" || typeof r == "bigint") return e = e.get(n) || null, u(t, e, "" + r, i);
				if (typeof r == "object" && r) {
					switch (r.$$typeof) {
						case Do: return e = e.get(r.key === null ? n : r.key) || null, d(t, e, r, i);
						case Oo: return e = e.get(r.key === null ? n : r.key) || null, f(t, e, r, i);
						case Ro: return r = ot(r), g(e, t, n, r, i);
					}
					if (qo(r) || l(r)) return e = e.get(n) || null, p(t, e, r, i, null);
					if (typeof r.then == "function") return g(e, t, n, lt(r), i);
					if (r.$$typeof === No) return g(e, t, n, ze(t, r), i);
					dt(t, r);
				}
				return null;
			}
			function _(t, r, o, c) {
				for (var l = null, u = null, d = r, f = r = 0, p = null; d !== null && f < o.length; f++) {
					d.index > f ? (p = d, d = null) : p = d.sibling;
					var _ = h(t, d, o[f], c);
					if (_ === null) {
						d === null && (d = p);
						break;
					}
					e && d && _.alternate === null && n(t, d), r = s(_, r, f), u === null ? l = _ : u.sibling = _, u = _, d = p;
				}
				if (f === o.length) return i(t, d), G && he(t, f), l;
				if (d === null) {
					for (; f < o.length; f++) d = m(t, o[f], c), d !== null && (r = s(d, r, f), u === null ? l = d : u.sibling = d, u = d);
					return G && he(t, f), l;
				}
				for (d = a(d); f < o.length; f++) p = g(d, t, f, o[f], c), p !== null && (e && (_ = p.alternate, _ !== null && d.delete(_.key === null ? f : _.key)), r = s(p, r, f), u === null ? l = p : u.sibling = p, u = p);
				return e && d.forEach(function(e) {
					return n(t, e);
				}), G && he(t, f), l;
			}
			function v(t, o, c, l) {
				if (c == null) throw Error(r(151));
				for (var u = null, d = null, f = o, p = o = 0, _ = null, v = c.next(); f !== null && !v.done; p++, v = c.next()) {
					f.index > p ? (_ = f, f = null) : _ = f.sibling;
					var y = h(t, f, v.value, l);
					if (y === null) {
						f === null && (f = _);
						break;
					}
					e && f && y.alternate === null && n(t, f), o = s(y, o, p), d === null ? u = y : d.sibling = y, d = y, f = _;
				}
				if (v.done) return i(t, f), G && he(t, p), u;
				if (f === null) {
					for (; !v.done; p++, v = c.next()) v = m(t, v.value, l), v !== null && (o = s(v, o, p), d === null ? u = v : d.sibling = v, d = v);
					return G && he(t, p), u;
				}
				for (f = a(f); !v.done; p++, v = c.next()) v = g(f, t, p, v.value, l), v !== null && (e && (_ = v.alternate, _ !== null && f.delete(_.key === null ? p : _.key)), o = s(v, o, p), d === null ? u = v : d.sibling = v, d = v);
				return e && f.forEach(function(e) {
					return n(t, e);
				}), G && he(t, p), u;
			}
			function y(e, t, a, s) {
				if (typeof a == "object" && a && a.type === ko && a.key === null && a.props.ref === void 0 && (a = a.props.children), typeof a == "object" && a) {
					switch (a.$$typeof) {
						case Do:
							a: {
								for (var u = a.key; t !== null;) {
									if (t.key === u) {
										if (u = a.type, u === ko) {
											if (t.tag === 7) {
												i(e, t.sibling), s = o(t, a.props.children), ut(s, a), s.return = e, e = s;
												break a;
											}
										} else if (t.elementType === u || typeof u == "object" && u && u.$$typeof === Ro && ot(u) === t.type) {
											i(e, t.sibling), s = o(t, a.props), ut(s, a), s.return = e, e = s;
											break a;
										}
										i(e, t);
										break;
									}
									n(e, t), t = t.sibling;
								}
								a.type === ko ? (s = po(a.props.children, e.mode, s, a.key), ut(s, a), s.return = e, e = s) : (s = L(a.type, a.key, a.props, null, e.mode, s), ut(s, a), s.return = e, e = s);
							}
							return c(e);
						case Oo:
							a: {
								for (u = a.key; t !== null;) {
									if (t.key === u) {
										if (t.tag === 4 && t.stateNode.containerInfo === a.containerInfo && t.stateNode.implementation === a.implementation) {
											i(e, t.sibling), s = o(t, a.children || []), s.return = e, e = s;
											break a;
										}
										i(e, t);
										break;
									}
									n(e, t), t = t.sibling;
								}
								s = go(a, e.mode, s), s.return = e, e = s;
							}
							return c(e);
						case Ro: return a = ot(a), y(e, t, a, s);
					}
					if (qo(a)) return _(e, t, a, s);
					if (l(a)) {
						if (u = l(a), typeof u != "function") throw Error(r(150));
						return a = u.call(a), v(e, t, a, s);
					}
					if (typeof a.then == "function") return y(e, t, lt(a), s);
					if (a.$$typeof === No) return y(e, t, ze(e, a), s);
					dt(e, a);
				}
				return typeof a == "string" && a !== "" || typeof a == "number" || typeof a == "bigint" ? (a = "" + a, t !== null && t.tag === 6 ? (i(e, t.sibling), s = o(t, a), s.return = e, e = s) : (i(e, t), s = mo(a, e.mode, s), s.return = e, e = s), c(e)) : i(e, t);
			}
			return function(e, n, r, i) {
				try {
					qu = 0;
					var a = y(e, n, r, i);
					return Ku = null, a;
				} catch (n) {
					if (n === Vu || n === Uu) throw n;
					var o = t(29, n, null, e.mode);
					return o.lanes = i, o.return = e, o;
				}
			};
		}
		function pt() {
			for (var e = Zu, t = Qu = Zu = 0; t < e;) {
				var n = Xu[t];
				Xu[t++] = null;
				var r = Xu[t];
				Xu[t++] = null;
				var i = Xu[t];
				Xu[t++] = null;
				var a = Xu[t];
				if (Xu[t++] = null, r !== null && i !== null) {
					var o = r.pending;
					o === null ? i.next = i : (i.next = o.next, o.next = i), r.pending = i;
				}
				a !== 0 && _t(n, i, a);
			}
		}
		function mt(e, t, n, r) {
			Xu[Zu++] = e, Xu[Zu++] = t, Xu[Zu++] = n, Xu[Zu++] = r, Qu |= r, e.lanes |= r, e = e.alternate, e !== null && (e.lanes |= r);
		}
		function ht(e, t, n, r) {
			return mt(e, t, n, r), vt(e);
		}
		function gt(e, t) {
			return mt(e, null, null, t), vt(e);
		}
		function _t(e, t, n) {
			e.lanes |= n;
			var r = e.alternate;
			r !== null && (r.lanes |= n);
			for (var i = !1, a = e.return; a !== null;) a.childLanes |= n, r = a.alternate, r !== null && (r.childLanes |= n), a.tag === 22 && (e = a.stateNode, e === null || e._visibility & 1 || (i = !0)), e = a, a = a.return;
			return e.tag === 3 ? (a = e.stateNode, i && t !== null && (i = 31 - Al(n), e = a.hiddenUpdates, r = e[i], r === null ? e[i] = [t] : r.push(t), t.lane = n | 536870912), a) : null;
		}
		function vt(e) {
			if (50 < Tf) throw Tf = 0, Ef = null, Error(r(185));
			for (var t = e.return; t !== null;) e = t, t = e.return;
			return e.tag === 3 ? e.stateNode : null;
		}
		function yt(e) {
			e.updateQueue = {
				baseState: e.memoizedState,
				firstBaseUpdate: null,
				lastBaseUpdate: null,
				shared: {
					pending: null,
					lanes: 0,
					hiddenCallbacks: null
				},
				callbacks: null
			};
		}
		function bt(e, t) {
			e = e.updateQueue, t.updateQueue === e && (t.updateQueue = {
				baseState: e.baseState,
				firstBaseUpdate: e.firstBaseUpdate,
				lastBaseUpdate: e.lastBaseUpdate,
				shared: e.shared,
				callbacks: null
			});
		}
		function xt(e) {
			return {
				lane: e,
				tag: 0,
				payload: null,
				callback: null,
				next: null
			};
		}
		function St(e, t, n) {
			var r = e.updateQueue;
			if (r === null) return null;
			if (r = r.shared, Y & 2) {
				var i = r.pending;
				return i === null ? t.next = t : (t.next = i.next, i.next = t), r.pending = t, t = vt(e), _t(e, null, n), t;
			}
			return mt(e, r, t, n), vt(e);
		}
		function Ct(e, t, n) {
			if (t = t.updateQueue, t !== null && (t = t.shared, n & 4194048)) {
				var r = t.lanes;
				r &= e.pendingLanes, n |= r, t.lanes = n, C(e, n);
			}
		}
		function wt(e, t) {
			var n = e.updateQueue, r = e.alternate;
			if (r !== null && (r = r.updateQueue, n === r)) {
				var i = null, a = null;
				if (n = n.firstBaseUpdate, n !== null) {
					do {
						var o = {
							lane: n.lane,
							tag: n.tag,
							payload: n.payload,
							callback: null,
							next: null
						};
						a === null ? i = a = o : a = a.next = o, n = n.next;
					} while (n !== null);
					a === null ? i = a = t : a = a.next = t;
				} else i = a = t;
				n = {
					baseState: r.baseState,
					firstBaseUpdate: i,
					lastBaseUpdate: a,
					shared: r.shared,
					callbacks: r.callbacks
				}, e.updateQueue = n;
				return;
			}
			e = n.lastBaseUpdate, e === null ? n.firstBaseUpdate = t : e.next = t, n.lastBaseUpdate = t;
		}
		function Tt() {
			if (ed) {
				var e = Ru;
				if (e !== null) throw e;
			}
		}
		function Et(e, t, n, r) {
			ed = !1;
			var i = e.updateQueue;
			$u = !1;
			var a = i.firstBaseUpdate, o = i.lastBaseUpdate, s = i.shared.pending;
			if (s !== null) {
				i.shared.pending = null;
				var c = s, l = c.next;
				c.next = null, o === null ? a = l : o.next = l, o = c;
				var u = e.alternate;
				u !== null && (u = u.updateQueue, s = u.lastBaseUpdate, s !== o && (s === null ? u.firstBaseUpdate = l : s.next = l, u.lastBaseUpdate = c));
			}
			if (a !== null) {
				var d = i.baseState;
				o = 0, u = l = c = null, s = a;
				do {
					var f = s.lane & -536870913, p = f !== s.lane;
					if (p ? (Q & f) === f : (r & f) === f) {
						f !== 0 && f === Lu && (ed = !0), u !== null && (u = u.next = {
							lane: 0,
							tag: s.tag,
							payload: s.payload,
							callback: null,
							next: null
						});
						a: {
							var m = e, h = s;
							f = t;
							var g = n;
							switch (h.tag) {
								case 1:
									if (m = h.payload, typeof m == "function") {
										d = m.call(g, d, f);
										break a;
									}
									d = m;
									break a;
								case 3: m.flags = m.flags & -65537 | 128;
								case 0:
									if (m = h.payload, f = typeof m == "function" ? m.call(g, d, f) : m, f == null) break a;
									d = To({}, d, f);
									break a;
								case 2: $u = !0;
							}
						}
						f = s.callback, f !== null && (e.flags |= 64, p && (e.flags |= 8192), p = i.callbacks, p === null ? i.callbacks = [f] : p.push(f));
					} else p = {
						lane: f,
						tag: s.tag,
						payload: s.payload,
						callback: s.callback,
						next: null
					}, u === null ? (l = u = p, c = d) : u = u.next = p, o |= f;
					if (s = s.next, s === null) {
						if (s = i.shared.pending, s === null) break;
						p = s, s = p.next, p.next = null, i.lastBaseUpdate = p, i.shared.pending = null;
					}
				} while (1);
				u === null && (c = d), i.baseState = c, i.firstBaseUpdate = l, i.lastBaseUpdate = u, a === null && (i.shared.lanes = 0), tf |= o, e.lanes = o, e.memoizedState = d;
			}
		}
		function Dt(e, t) {
			if (typeof e != "function") throw Error(r(191, e));
			e.call(t);
		}
		function Ot(e, t) {
			var n = e.callbacks;
			if (n !== null) for (e.callbacks = null, e = 0; e < n.length; e++) Dt(n[e], t);
		}
		function kt(e, t) {
			e = $d, m(nd, e), m(td, t), $d = e | t.baseLanes;
		}
		function At() {
			m(nd, $d), m(td, td.current);
		}
		function jt() {
			$d = nd.current, p(td), p(nd);
		}
		function Mt(e) {
			var t = e.alternate;
			m(ad, ad.current & 1), m(rd, e), id === null && (t === null || td.current !== null || t.memoizedState !== null) && (id = e);
		}
		function Nt(e) {
			m(ad, ad.current), m(rd, e), id === null && (id = e);
		}
		function Pt(e) {
			e.tag === 22 ? (m(ad, ad.current), m(rd, e), id === null && (id = e)) : Ft();
		}
		function Ft() {
			m(ad, ad.current), m(rd, rd.current);
		}
		function It(e) {
			p(rd), id === e && (id = null), p(ad);
		}
		function Lt(e, t) {
			m(rd, rd.current), m(ad, t);
		}
		function Rt(e) {
			p(ad), p(rd), id === e && (id = null);
		}
		function zt(e) {
			for (var t = e; t !== null;) {
				if (t.tag === 13) {
					var n = t.memoizedState;
					if (n !== null && (n = n.dehydrated, n === null || Tc(n) || Ec(n))) return t;
				} else if (t.tag === 19 && t.memoizedProps.revealOrder !== "independent") {
					if (t.flags & 128) return t;
				} else if (t.child !== null) {
					t.child.return = t, t = t.child;
					continue;
				}
				if (t === e) break;
				for (; t.sibling === null;) {
					if (t.return === null || t.return === e) return null;
					t = t.return;
				}
				t.sibling.return = t.return, t = t.sibling;
			}
			return null;
		}
		function Bt() {
			throw Error(r(321));
		}
		function Vt(e, t) {
			if (t === null) return !1;
			for (var n = 0; n < t.length && n < e.length; n++) if (!Xl(e[n], t[n])) return !1;
			return !0;
		}
		function Ht(e, t, n, r, i, a) {
			return od = a, K = t, t.memoizedState = null, t.updateQueue = null, t.lanes = 0, B.H = e === null || e.memoizedState === null ? gd : _d, ud = !1, a = n(r, i), ud = !1, ld && (a = Wt(t, n, r, i)), Ut(e), a;
		}
		function Ut(e) {
			B.H = hd;
			var t = q !== null && q.next !== null;
			if (od = 0, sd = q = K = null, cd = !1, fd = 0, pd = null, t) throw Error(r(300));
			e === null || xd || (e = e.dependencies, e !== null && Ie(e) && (xd = !0));
		}
		function Wt(e, t, n, i) {
			K = e;
			var a = 0;
			do {
				if (ld && (pd = null), fd = 0, ld = !1, 25 <= a) throw Error(r(301));
				if (a += 1, sd = q = null, e.updateQueue != null) {
					var o = e.updateQueue;
					o.lastEffect = null, o.events = null, o.stores = null, o.memoCache != null && (o.memoCache.index = 0);
				}
				B.H = vd, o = t(n, i);
			} while (ld);
			return o;
		}
		function Gt() {
			var e = B.H, t = e.useState()[0];
			return t = typeof t.then == "function" ? Qt(t) : t, e = e.useState()[0], (q === null ? null : q.memoizedState) !== e && (K.flags |= 1024), t;
		}
		function Kt() {
			var e = dd !== 0;
			return dd = 0, e;
		}
		function qt(e, t, n) {
			t.updateQueue = e.updateQueue, t.flags &= -2053, e.lanes &= ~n;
		}
		function Jt(e) {
			if (cd) {
				for (e = e.memoizedState; e !== null;) {
					var t = e.queue;
					t !== null && (t.pending = null), e = e.next;
				}
				cd = !1;
			}
			od = 0, sd = q = K = null, ld = !1, fd = dd = 0, pd = null;
		}
		function Yt() {
			var e = {
				memoizedState: null,
				baseState: null,
				baseQueue: null,
				queue: null,
				next: null
			};
			return sd === null ? K.memoizedState = sd = e : sd = sd.next = e, sd;
		}
		function Xt() {
			if (q === null) {
				var e = K.alternate;
				e = e === null ? null : e.memoizedState;
			} else e = q.next;
			var t = sd === null ? K.memoizedState : sd.next;
			if (t !== null) sd = t, q = e;
			else {
				if (e === null) throw K.alternate === null ? Error(r(467)) : Error(r(310));
				q = e, e = {
					memoizedState: q.memoizedState,
					baseState: q.baseState,
					baseQueue: q.baseQueue,
					queue: q.queue,
					next: null
				}, sd === null ? K.memoizedState = sd = e : sd = sd.next = e;
			}
			return sd;
		}
		function Zt() {
			return {
				lastEffect: null,
				events: null,
				stores: null,
				memoCache: null
			};
		}
		function Qt(e) {
			var t = fd;
			return fd += 1, pd === null && (pd = []), e = at(pd, e, t), t = K, (sd === null ? t.memoizedState : sd.next) === null && (t = t.alternate, B.H = t === null || t.memoizedState === null ? gd : _d), e;
		}
		function $t(e) {
			if (typeof e == "object" && e) {
				if (typeof e.then == "function") return Qt(e);
				if (e.$$typeof === Uo) return;
				if (e.$$typeof === No) return Re(e);
			}
			throw Error(r(438, String(e)));
		}
		function en(e) {
			var t = null, n = K.updateQueue;
			if (n !== null && (t = n.memoCache), t == null) {
				var r = K.alternate;
				r !== null && (r = r.updateQueue, r !== null && (r = r.memoCache, r != null && (t = {
					data: r.data.map(function(e) {
						return e.slice();
					}),
					index: 0
				})));
			}
			if (t ??= {
				data: [],
				index: 0
			}, n === null && (n = Zt(), K.updateQueue = n), n.memoCache = t, n = t.data[t.index], n === void 0) for (n = t.data[t.index] = Array(e), r = 0; r < e; r++) n[r] = Vo;
			return t.index++, n;
		}
		function tn(e, t) {
			return typeof t == "function" ? t(e) : t;
		}
		function nn(e) {
			return rn(Xt(), q, e);
		}
		function rn(e, t, n) {
			var i = e.queue;
			if (i === null) throw Error(r(311));
			i.lastRenderedReducer = n;
			var a = e.baseQueue, o = i.pending;
			if (o !== null) {
				if (a !== null) {
					var s = a.next;
					a.next = o.next, o.next = s;
				}
				t.baseQueue = a = o, i.pending = null;
			}
			if (o = e.baseState, a === null) e.memoizedState = o;
			else {
				t = a.next;
				var c = s = null, l = null, u = t, d = !1;
				do {
					var f = u.lane & -536870913;
					if (f === u.lane ? (od & f) === f : (Q & f) === f) {
						var p = u.revertLane;
						if (p === 0) l !== null && (l = l.next = {
							lane: 0,
							revertLane: 0,
							gesture: null,
							action: u.action,
							hasEagerState: u.hasEagerState,
							eagerState: u.eagerState,
							next: null
						}), f === Lu && (d = !0);
						else if ((od & p) === p) {
							u = u.next, p === Lu && (d = !0);
							continue;
						} else f = {
							lane: 0,
							revertLane: u.revertLane,
							gesture: null,
							action: u.action,
							hasEagerState: u.hasEagerState,
							eagerState: u.eagerState,
							next: null
						}, l === null ? (c = l = f, s = o) : l = l.next = f, K.lanes |= p, tf |= p;
						f = u.action, ud && n(o, f), o = u.hasEagerState ? u.eagerState : n(o, f);
					} else p = {
						lane: f,
						revertLane: u.revertLane,
						gesture: u.gesture,
						action: u.action,
						hasEagerState: u.hasEagerState,
						eagerState: u.eagerState,
						next: null
					}, l === null ? (c = l = p, s = o) : l = l.next = p, K.lanes |= f, tf |= f;
					u = u.next;
				} while (u !== null && u !== t);
				if (l === null ? s = o : l.next = c, !Xl(o, e.memoizedState) && (xd = !0, d && (n = Ru, n !== null))) throw n;
				e.memoizedState = o, e.baseState = s, e.baseQueue = l, i.lastRenderedState = o;
			}
			return a === null && (i.lanes = 0), [e.memoizedState, i.dispatch];
		}
		function an(e) {
			var t = Xt(), n = t.queue;
			if (n === null) throw Error(r(311));
			n.lastRenderedReducer = e;
			var i = n.dispatch, a = n.pending, o = t.memoizedState;
			if (a !== null) {
				n.pending = null;
				var s = a = a.next;
				do
					o = e(o, s.action), s = s.next;
				while (s !== a);
				Xl(o, t.memoizedState) || (xd = !0), t.memoizedState = o, t.baseQueue === null && (t.baseState = o), n.lastRenderedState = o;
			}
			return [o, i];
		}
		function on(e, t, n) {
			var i = K, a = Xt(), o = G;
			if (o) {
				if (n === void 0) throw Error(r(407));
				n = n();
			} else n = t();
			var s = !Xl((q || a).memoizedState, n);
			if (s && (a.memoizedState = n, xd = !0), a = a.queue, kn(ln.bind(null, i, a, e), [e]), e = a.getSnapshot !== t || s || sd !== null && !!(sd.memoizedState.tag & 1), wn(e ? 9 : 8, { destroy: void 0 }, cn.bind(null, i, a, n, t), null), e) {
				if (i.flags |= 2048, X === null) throw Error(r(349));
				o || od & 127 || sn(i, t, n);
			}
			return n;
		}
		function sn(e, t, n) {
			e.flags |= 16384, e = {
				getSnapshot: t,
				value: n
			}, t = K.updateQueue, t === null ? (t = Zt(), K.updateQueue = t, t.stores = [e]) : (n = t.stores, n === null ? t.stores = [e] : n.push(e));
		}
		function cn(e, t, n, r) {
			t.value = n, t.getSnapshot = r, un(t) && dn(e);
		}
		function ln(e, t, n) {
			return n(function() {
				un(t) && dn(e);
			});
		}
		function un(e) {
			var t = e.getSnapshot;
			e = e.value;
			try {
				var n = t();
				return !Xl(e, n);
			} catch {
				return !0;
			}
		}
		function dn(e) {
			var t = gt(e, 2);
			t !== null && Ta(t, e, 2);
		}
		function fn(e) {
			var t = Yt();
			if (typeof e == "function") {
				var n = e;
				if (e = n(), ud) {
					oe(!0);
					try {
						n();
					} finally {
						oe(!1);
					}
				}
			}
			return t.memoizedState = t.baseState = e, t.queue = {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: tn,
				lastRenderedState: e
			}, t;
		}
		function pn(e, t, n, r) {
			return e.baseState = n, rn(e, q, typeof r == "function" ? r : tn);
		}
		function mn(e, t, n, i, a) {
			if (Zn(e)) throw Error(r(485));
			if (e = t.action, e !== null) {
				var o = {
					payload: a,
					action: e,
					next: null,
					isTransition: !0,
					status: "pending",
					value: null,
					reason: null,
					listeners: [],
					then: function(e) {
						o.listeners.push(e);
					}
				};
				B.T === null ? o.isTransition = !1 : n(!0), i(o), n = t.pending, n === null ? (o.next = t.pending = o, k(t, o)) : (o.next = n.next, t.pending = n.next = o);
			}
		}
		function k(e, t) {
			var n = t.action, r = t.payload, i = e.state;
			if (t.isTransition) {
				var a = B.T, o = {};
				o.types = a === null ? null : a.types, B.T = o;
				try {
					var s = n(i, r), c = B.S;
					c !== null && c(o, s), A(e, t, s);
				} catch (n) {
					gn(e, t, n);
				} finally {
					a !== null && o.types !== null && (a.types = o.types), B.T = a;
				}
			} else try {
				a = n(i, r), A(e, t, a);
			} catch (n) {
				gn(e, t, n);
			}
		}
		function A(e, t, n) {
			typeof n == "object" && n && typeof n.then == "function" ? n.then(function(n) {
				hn(e, t, n);
			}, function(n) {
				return gn(e, t, n);
			}) : hn(e, t, n);
		}
		function hn(e, t, n) {
			t.status = "fulfilled", t.value = n, _n(t), e.state = n, t = e.pending, t !== null && (n = t.next, n === t ? e.pending = null : (n = n.next, t.next = n, k(e, n)));
		}
		function gn(e, t, n) {
			var r = e.pending;
			if (e.pending = null, r !== null) {
				r = r.next;
				do
					t.status = "rejected", t.reason = n, _n(t), t = t.next;
				while (t !== r);
			}
			e.action = null;
		}
		function _n(e) {
			e = e.listeners;
			for (var t = 0; t < e.length; t++) (0, e[t])();
		}
		function vn(e, t) {
			return t;
		}
		function yn(e, t) {
			if (G) {
				var n = X.formState;
				if (n !== null) {
					a: {
						var r = K;
						if (G) {
							if (_u) {
								var i = kc(_u, yu);
								if (i) {
									_u = jc(i), r = Ac(i);
									break a;
								}
							}
							we(r);
						}
						r = !1;
					}
					r && (t = n[0]);
				}
			}
			n = Yt(), n.memoizedState = n.baseState = t, r = {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: vn,
				lastRenderedState: t
			}, n.queue = r, n = Jn.bind(null, K, r), r.dispatch = n, r = fn(!1);
			var a = Xn.bind(null, K, !1, r.queue);
			return r = Yt(), i = {
				state: t,
				dispatch: null,
				action: e,
				pending: null
			}, r.queue = i, n = mn.bind(null, K, i, a, n), i.dispatch = n, r.memoizedState = e, [
				t,
				n,
				!1
			];
		}
		function bn(e) {
			return xn(Xt(), q, e);
		}
		function xn(e, t, n) {
			if (t = rn(e, t, vn)[0], e = nn(tn)[0], typeof t == "object" && t && typeof t.then == "function") try {
				var r = Qt(t);
			} catch (e) {
				throw e === Vu ? Uu : e;
			}
			else r = t;
			t = Xt();
			var i = t.queue, a = i.dispatch;
			return n !== t.memoizedState && (K.flags |= 2048, wn(9, { destroy: void 0 }, Sn.bind(null, i, n), null)), [
				r,
				a,
				e
			];
		}
		function Sn(e, t) {
			e.action = t;
		}
		function Cn(e) {
			var t = Xt(), n = q;
			if (n !== null) return xn(t, n, e);
			Xt(), t = t.memoizedState, n = Xt();
			var r = n.queue.dispatch;
			return n.memoizedState = e, [
				t,
				r,
				!1
			];
		}
		function wn(e, t, n, r) {
			return e = {
				tag: e,
				create: n,
				deps: r,
				inst: t,
				next: null
			}, t = K.updateQueue, t === null && (t = Zt(), K.updateQueue = t), n = t.lastEffect, n === null ? t.lastEffect = e.next = e : (r = n.next, n.next = e, e.next = r, t.lastEffect = e), e;
		}
		function Tn() {
			return Xt().memoizedState;
		}
		function En(e, t, n, r) {
			var i = Yt();
			K.flags |= e, i.memoizedState = wn(1 | t, { destroy: void 0 }, n, r === void 0 ? null : r);
		}
		function Dn(e, t, n, r) {
			var i = Xt();
			r = r === void 0 ? null : r;
			var a = i.memoizedState.inst;
			q !== null && r !== null && Vt(r, q.memoizedState.deps) ? i.memoizedState = wn(t, a, n, r) : (K.flags |= e, i.memoizedState = wn(1 | t, a, n, r));
		}
		function On(e, t) {
			En(8390656, 8, e, t);
		}
		function kn(e, t) {
			Dn(2048, 8, e, t);
		}
		function An(e) {
			K.flags |= 4;
			var t = K.updateQueue;
			if (t === null) t = Zt(), K.updateQueue = t, t.events = [e];
			else {
				var n = t.events;
				n === null ? t.events = [e] : n.push(e);
			}
		}
		function jn(e) {
			var t = Xt().memoizedState;
			return An({
				ref: t,
				nextImpl: e
			}), function() {
				if (Y & 2) throw Error(r(440));
				return t.impl.apply(void 0, arguments);
			};
		}
		function Mn(e, t) {
			return Dn(4, 2, e, t);
		}
		function Nn(e, t) {
			return Dn(4, 4, e, t);
		}
		function Pn(e, t) {
			if (typeof t == "function") {
				e = e();
				var n = t(e);
				return function() {
					typeof n == "function" ? n() : t(null);
				};
			}
			if (t != null) return e = e(), t.current = e, function() {
				t.current = null;
			};
		}
		function Fn(e, t, n) {
			n = n == null ? null : n.concat([e]), Dn(4, 4, Pn.bind(null, t, e), n);
		}
		function In() {}
		function Ln(e, t) {
			var n = Xt();
			t = t === void 0 ? null : t;
			var r = n.memoizedState;
			return t !== null && Vt(t, r[1]) ? r[0] : (n.memoizedState = [e, t], e);
		}
		function Rn(e, t) {
			var n = Xt();
			t = t === void 0 ? null : t;
			var r = n.memoizedState;
			if (t !== null && Vt(t, r[1])) return r[0];
			if (r = e(), ud) {
				oe(!0);
				try {
					e();
				} finally {
					oe(!1);
				}
			}
			return n.memoizedState = [r, t], r;
		}
		function zn(e, t, n) {
			return n === void 0 || od & 1073741824 && !(Q & 261930) ? e.memoizedState = t : (e.memoizedState = n, e = Ca(), K.lanes |= e, tf |= e, n);
		}
		function Bn(e, t, n, r) {
			return Xl(n, t) ? n : td.current === null ? !(od & 106) || od & 1073741824 && !(Q & 261930) ? (xd = !0, e.memoizedState = n) : (e = Ca(), K.lanes |= e, tf |= e, t) : (e = zn(e, n, r), Xl(e, t) || (xd = !0), e);
		}
		function Vn(e, t, n, r, i) {
			var a = gs();
			hs(a !== 0 && 8 > a ? a : 8);
			var o = B.T, s = {};
			s.types = o === null ? null : o.types, B.T = s, Xn(e, !1, t, n);
			try {
				var c = i(), l = B.S;
				l !== null && l(s, c), typeof c == "object" && c && typeof c.then == "function" ? Yn(e, t, $e(c, r), Sa(e)) : Yn(e, t, r, Sa(e));
			} catch (n) {
				Yn(e, t, {
					then: function() {},
					status: "rejected",
					reason: n
				}, Sa());
			} finally {
				hs(a), o !== null && s.types !== null && (o.types = s.types), B.T = o;
			}
		}
		function Hn(e) {
			var t = e.memoizedState;
			if (t !== null) return t;
			t = {
				memoizedState: Os,
				baseState: Os,
				baseQueue: null,
				queue: {
					pending: null,
					lanes: 0,
					dispatch: null,
					lastRenderedReducer: tn,
					lastRenderedState: Os
				},
				next: null
			};
			var n = {};
			return t.next = {
				memoizedState: n,
				baseState: n,
				baseQueue: null,
				queue: {
					pending: null,
					lanes: 0,
					dispatch: null,
					lastRenderedReducer: tn,
					lastRenderedState: n
				},
				next: null
			}, e.memoizedState = t, e = e.alternate, e !== null && (e.memoizedState = t), t;
		}
		function Un() {
			return Re(ks);
		}
		function Wn() {
			return Xt().memoizedState;
		}
		function Gn() {
			return Xt().memoizedState;
		}
		function Kn(e) {
			for (var t = e.return; t !== null;) {
				switch (t.tag) {
					case 24:
					case 3:
						var n = Sa();
						e = xt(n);
						var r = St(t, e, n);
						r !== null && (Ta(r, t, n), Ct(r, t, n)), t = { cache: Ve() }, e.payload = t;
						return;
				}
				t = t.return;
			}
		}
		function qn(e, t, n) {
			var r = Sa();
			n = {
				lane: r,
				revertLane: 0,
				gesture: null,
				action: n,
				hasEagerState: !1,
				eagerState: null,
				next: null
			}, Zn(e) ? Qn(t, n) : (n = ht(e, t, n, r), n !== null && (Ta(n, e, r), $n(n, t, r)));
		}
		function Jn(e, t, n) {
			Yn(e, t, n, Sa());
		}
		function Yn(e, t, n, r) {
			var i = {
				lane: r,
				revertLane: 0,
				gesture: null,
				action: n,
				hasEagerState: !1,
				eagerState: null,
				next: null
			};
			if (Zn(e)) Qn(t, i);
			else {
				var a = e.alternate;
				if (e.lanes === 0 && (a === null || a.lanes === 0) && (a = t.lastRenderedReducer, a !== null)) try {
					var o = t.lastRenderedState, s = a(o, n);
					if (i.hasEagerState = !0, i.eagerState = s, Xl(s, o)) return mt(e, t, i, 0), X === null && pt(), !1;
				} catch {}
				if (n = ht(e, t, i, r), n !== null) return Ta(n, e, r), $n(n, t, r), !0;
			}
			return !1;
		}
		function Xn(e, t, n, i) {
			if (i = {
				lane: 2,
				revertLane: O(),
				gesture: null,
				action: i,
				hasEagerState: !1,
				eagerState: null,
				next: null
			}, Zn(e)) {
				if (t) throw Error(r(479));
			} else t = ht(e, n, i, 2), t !== null && Ta(t, e, 2);
		}
		function Zn(e) {
			var t = e.alternate;
			return e === K || t !== null && t === K;
		}
		function Qn(e, t) {
			ld = cd = !0;
			var n = e.pending;
			n === null ? t.next = t : (t.next = n.next, n.next = t), e.pending = t;
		}
		function $n(e, t, n) {
			if (n & 4194048) {
				var r = t.lanes;
				r &= e.pendingLanes, n |= r, t.lanes = n, C(e, n);
			}
		}
		function er(e, t, n, r) {
			t = e.memoizedState, n = n(r, t), n = n == null ? t : To({}, t, n), e.memoizedState = n, e.lanes === 0 && (e.updateQueue.baseState = n);
		}
		function tr(e, t, n, r, i, a, o) {
			return e = e.stateNode, typeof e.shouldComponentUpdate == "function" ? e.shouldComponentUpdate(r, a, o) : t.prototype && t.prototype.isPureReactComponent ? !rt(n, r) || !rt(i, a) : !0;
		}
		function nr(e, t, n, r) {
			e = t.state, typeof t.componentWillReceiveProps == "function" && t.componentWillReceiveProps(n, r), typeof t.UNSAFE_componentWillReceiveProps == "function" && t.UNSAFE_componentWillReceiveProps(n, r), t.state !== e && yd.enqueueReplaceState(t, t.state, null);
		}
		function rr(e, t) {
			var n = t;
			if ("ref" in t) for (var r in n = {}, t) r !== "ref" && (n[r] = t[r]);
			if (e = e.defaultProps) for (var i in n === t && (n = To({}, n)), e) n[i] === void 0 && (n[i] = e[i]);
			return n;
		}
		function ir(e, t) {
			try {
				var n = e.onUncaughtError;
				n(t.value, { componentStack: t.stack });
			} catch (e) {
				setTimeout(function() {
					throw e;
				});
			}
		}
		function ar(e, t, n) {
			try {
				var r = e.onCaughtError;
				r(n.value, {
					componentStack: n.stack,
					errorBoundary: t.tag === 1 ? t.stateNode : null
				});
			} catch (e) {
				setTimeout(function() {
					throw e;
				});
			}
		}
		function or(e, t, n) {
			return n = xt(n), n.tag = 3, n.payload = { element: null }, n.callback = function() {
				ir(e, t);
			}, n;
		}
		function sr(e) {
			return e = xt(e), e.tag = 3, e;
		}
		function cr(e, t, n, r) {
			var i = n.type.getDerivedStateFromError;
			if (typeof i == "function") {
				var a = r.value;
				e.payload = function() {
					return i(a);
				}, e.callback = function() {
					ar(t, n, r);
				};
			}
			var o = n.stateNode;
			o !== null && typeof o.componentDidCatch == "function" && (e.callback = function() {
				ar(t, n, r), typeof i != "function" && (mf === null ? mf = /* @__PURE__ */ new Set([this]) : mf.add(this));
				var e = r.stack;
				this.componentDidCatch(r.value, { componentStack: e === null ? "" : e });
			});
		}
		function lr(e, t, n, i, a) {
			if (n.flags |= 32768, typeof i == "object" && i && typeof i.then == "function") {
				if (t = n.alternate, t !== null && Fe(t, n, a, !0), n = rd.current, n !== null) {
					switch (n.tag) {
						case 31:
						case 13:
						case 19: return id === null ? La() : n.alternate === null && ef === 0 && (ef = 3), n.flags &= -257, n.flags |= 65536, n.lanes = a, i === Wu ? n.flags |= 16384 : (t = n.updateQueue, t === null ? n.updateQueue = /* @__PURE__ */ new Set([i]) : t.add(i), F(e, i, a)), !1;
						case 22: return n.flags |= 65536, i === Wu ? n.flags |= 16384 : (t = n.updateQueue, t === null ? (t = {
							transitions: null,
							markerInstances: null,
							retryQueue: /* @__PURE__ */ new Set([i])
						}, n.updateQueue = t) : (n = t.retryQueue, n === null ? t.retryQueue = /* @__PURE__ */ new Set([i]) : n.add(i)), F(e, i, a)), !1;
					}
					throw Error(r(435, n.tag));
				}
				return F(e, i, a), La(), !1;
			}
			if (G) return t = rd.current, t === null ? (i !== bu && (t = Error(r(423), { cause: i }), Ae(me(t, n))), e = e.current.alternate, e.flags |= 65536, a &= -a, e.lanes |= a, i = me(i, n), a = or(e.stateNode, i, a), wt(e, a), ef !== 4 && (ef = 2)) : (!(t.flags & 65536) && (t.flags |= 256), t.flags |= 65536, t.lanes = a, i !== bu && (e = Error(r(422), { cause: i }), Ae(me(e, n)))), !1;
			var o = Error(r(520), { cause: i });
			if (o = me(o, n), sf === null ? sf = [o] : sf.push(o), ef !== 4 && (ef = 2), t === null) return !0;
			i = me(i, n), n = t;
			do {
				switch (n.tag) {
					case 3: return n.flags |= 65536, e = a & -a, n.lanes |= e, e = or(n.stateNode, i, e), wt(n, e), !1;
					case 1:
						if (t = n.type, o = n.stateNode, !(n.flags & 128) && (typeof t.getDerivedStateFromError == "function" || o !== null && typeof o.componentDidCatch == "function" && (mf === null || !mf.has(o)))) return n.flags |= 65536, a &= -a, n.lanes |= a, a = sr(a), cr(a, e, n, i), wt(n, a), !1;
						break;
					case 22: if (n.memoizedState !== null) return n.flags |= 65536, !1;
				}
				n = n.return;
			} while (n !== null);
			return !1;
		}
		function ur(e, t, n, r) {
			t.child = e === null ? Yu(t, null, n, r) : Ju(t, e.child, n, r);
		}
		function dr(e, t, n, r, i) {
			n = n.render;
			var a = t.ref;
			if ("ref" in r) {
				var o = {};
				for (var s in r) s !== "ref" && (o[s] = r[s]);
			} else o = r;
			return Le(t), r = Ht(e, t, n, o, a, i), s = Kt(), e !== null && !xd ? (qt(e, t, i), Rr(e, t, i)) : (G && s && _e(t), t.flags |= 1, ur(e, t, r, i), t.child);
		}
		function fr(e, t, n, r, i) {
			if (e === null) {
				var a = n.type;
				return typeof a == "function" && !lo(a) && a.defaultProps === void 0 && n.compare === null ? (t.tag = 15, t.type = a, pr(e, t, a, r, i)) : (e = L(n.type, null, r, t, t.mode, i), e.ref = t.ref, e.return = t, t.child = e);
			}
			if (a = e.child, !zr(e, i)) {
				var o = a.memoizedProps;
				if (n = n.compare, n = n === null ? rt : n, n(o, r) && e.ref === t.ref) return Rr(e, t, i);
			}
			return t.flags |= 1, e = uo(a, r), e.ref = t.ref, e.return = t, t.child = e;
		}
		function pr(e, t, n, r, i) {
			if (e !== null) {
				var a = e.memoizedProps;
				if (rt(a, r) && e.ref === t.ref) {
					if (xd = !1, t.pendingProps = r = a, zr(e, i)) e.flags & 131072 && (xd = !0);
					else return t.lanes = e.lanes, Rr(e, t, i);
				}
			}
			return xr(e, t, n, r, i);
		}
		function mr(e, t, n, r) {
			var i = r.children, a = e === null ? null : e.memoizedState;
			if (e === null && t.stateNode === null && (t.stateNode = {
				_visibility: 1,
				_pendingMarkers: null,
				_retryCache: null,
				_transitions: null
			}), r.mode === "hidden") {
				if (t.flags & 128) {
					if (a = a === null ? n : a.baseLanes | n, e !== null) {
						for (r = t.child = e.child, i = 0; r !== null;) i = i | r.lanes | r.childLanes, r = r.sibling;
						r = i & ~a;
					} else r = 0, t.child = null;
					return gr(e, t, a, n, r);
				}
				if (n & 536870912) t.memoizedState = {
					baseLanes: 0,
					cachePool: null
				}, e !== null && tt(t, a === null ? null : a.cachePool), a === null ? At() : kt(t, a), Pt(t);
				else return r = t.lanes = 536870912, gr(e, t, a === null ? n : a.baseLanes | n, n, r);
			} else a === null ? (e !== null && tt(t, null), At(), Ft()) : (tt(t, a.cachePool), kt(t, a), Ft(), t.memoizedState = null);
			return ur(e, t, i, n), t.child;
		}
		function hr(e, t) {
			return e !== null && e.tag === 22 || t.stateNode !== null || (t.stateNode = {
				_visibility: 1,
				_pendingMarkers: null,
				_retryCache: null,
				_transitions: null
			}), t.sibling;
		}
		function gr(e, t, n, r, i) {
			var a = et();
			return a = a === null ? null : {
				parent: us ? Du._currentValue : Du._currentValue2,
				pool: a
			}, t.memoizedState = {
				baseLanes: n,
				cachePool: a
			}, e !== null && tt(t, null), At(), Pt(t), e !== null && Fe(e, t, r, !0), t.childLanes = i, null;
		}
		function _r(e, t) {
			return t = kr({
				mode: t.mode,
				children: t.children
			}, e.mode), t.ref = e.ref, e.child = t, t.return = e, t;
		}
		function vr(e, t, n) {
			return Ju(t, e.child, null, n), e = _r(t, t.pendingProps), e.flags |= 2, It(t), t.memoizedState = null, e;
		}
		function yr(e, t, n) {
			var i = t.pendingProps, a = !!(t.flags & 128);
			if (t.flags &= -129, e === null) {
				if (G) {
					if (i.mode === "hidden") return e = _r(t, i), t.lanes = 536870912, e.memoizedState = {
						baseLanes: 0,
						cachePool: null
					}, hr(null, e);
					if (Nt(t), (e = _u) ? (e = Bc(e, yu), e !== null && (t.memoizedState = {
						dehydrated: e,
						treeContext: lu === null ? null : {
							id: uu,
							overflow: du
						},
						retryLane: 536870912,
						hydrationErrors: null
					}, n = ho(e), n.return = t, t.child = n, gu = t, _u = null)) : e = null, e === null) throw we(t);
					return t.lanes = 536870912, null;
				}
				return _r(t, i);
			}
			var o = e.memoizedState;
			if (o !== null) {
				var s = o.dehydrated;
				if (Nt(t), a) {
					if (t.flags & 256) t.flags &= -257, t = vr(e, t, n);
					else if (t.memoizedState !== null) t.child = e.child, t.flags |= 128, t = null;
					else throw Error(r(558));
				} else if (xd || Fe(e, t, n, !1), a = (n & e.childLanes) !== 0, xd || a) {
					if (td.current === null) {
						if (i = X, i !== null && (s = re(i, n), s !== 0 && s !== o.retryLane)) throw o.retryLane = s, gt(e, s), Ta(i, e, s), bd;
						La();
					}
					t = vr(e, t, n);
				} else e = o.treeContext, fs && (_u = Fc(s), gu = t, G = !0, vu = null, yu = !1, e !== null && ye(t, e)), t = _r(t, i), t.flags |= 134221824;
				return t;
			}
			return e = uo(e.child, {
				mode: i.mode,
				children: i.children
			}), e.ref = t.ref, t.child = e, e.return = t, e;
		}
		function br(e, t) {
			var n = t.ref;
			if (n === null) e !== null && e.ref !== null && (t.flags |= 4194816);
			else {
				if (typeof n != "function" && typeof n != "object") throw Error(r(284));
				(e === null || e.ref !== n) && (t.flags |= 4194816);
			}
		}
		function xr(e, t, n, r, i) {
			return Le(t), n = Ht(e, t, n, r, void 0, i), r = Kt(), e !== null && !xd ? (qt(e, t, i), Rr(e, t, i)) : (G && r && _e(t), t.flags |= 1, ur(e, t, n, i), t.child);
		}
		function Sr(e, t, n, r, i, a) {
			return Le(t), t.updateQueue = null, n = Wt(t, r, n, i), Ut(e), r = Kt(), e !== null && !xd ? (qt(e, t, a), Rr(e, t, a)) : (G && r && _e(t), t.flags |= 1, ur(e, t, n, a), t.child);
		}
		function Cr(e, t, n, r, i) {
			if (Le(t), t.stateNode === null) {
				var a = kl, o = n.contextType;
				typeof o == "object" && o && (a = Re(o)), a = new n(r, a), t.memoizedState = a.state !== null && a.state !== void 0 ? a.state : null, a.updater = yd, t.stateNode = a, a._reactInternals = t, a = t.stateNode, a.props = r, a.state = t.memoizedState, a.refs = {}, yt(t), o = n.contextType, a.context = typeof o == "object" && o ? Re(o) : kl, a.state = t.memoizedState, o = n.getDerivedStateFromProps, typeof o == "function" && (er(t, n, o, r), a.state = t.memoizedState), typeof n.getDerivedStateFromProps == "function" || typeof a.getSnapshotBeforeUpdate == "function" || typeof a.UNSAFE_componentWillMount != "function" && typeof a.componentWillMount != "function" || (o = a.state, typeof a.componentWillMount == "function" && a.componentWillMount(), typeof a.UNSAFE_componentWillMount == "function" && a.UNSAFE_componentWillMount(), o !== a.state && yd.enqueueReplaceState(a, a.state, null), Et(t, r, a, i), Tt(), a.state = t.memoizedState), typeof a.componentDidMount == "function" && (t.flags |= 4194308), r = !0;
			} else if (e === null) {
				a = t.stateNode;
				var s = t.memoizedProps, c = rr(n, s);
				a.props = c;
				var l = a.context, u = n.contextType;
				o = kl, typeof u == "object" && u && (o = Re(u));
				var d = n.getDerivedStateFromProps;
				u = typeof d == "function" || typeof a.getSnapshotBeforeUpdate == "function", s = t.pendingProps !== s, u || typeof a.UNSAFE_componentWillReceiveProps != "function" && typeof a.componentWillReceiveProps != "function" || (s || l !== o) && nr(t, a, r, o), $u = !1;
				var f = t.memoizedState;
				a.state = f, Et(t, r, a, i), Tt(), l = t.memoizedState, s || f !== l || $u ? (typeof d == "function" && (er(t, n, d, r), l = t.memoizedState), (c = $u || tr(t, n, c, r, f, l, o)) ? (u || typeof a.UNSAFE_componentWillMount != "function" && typeof a.componentWillMount != "function" || (typeof a.componentWillMount == "function" && a.componentWillMount(), typeof a.UNSAFE_componentWillMount == "function" && a.UNSAFE_componentWillMount()), typeof a.componentDidMount == "function" && (t.flags |= 4194308)) : (typeof a.componentDidMount == "function" && (t.flags |= 4194308), t.memoizedProps = r, t.memoizedState = l), a.props = r, a.state = l, a.context = o, r = c) : (typeof a.componentDidMount == "function" && (t.flags |= 4194308), r = !1);
			} else {
				a = t.stateNode, bt(e, t), o = t.memoizedProps, u = rr(n, o), a.props = u, d = t.pendingProps, f = a.context, l = n.contextType, c = kl, typeof l == "object" && l && (c = Re(l)), s = n.getDerivedStateFromProps, (l = typeof s == "function" || typeof a.getSnapshotBeforeUpdate == "function") || typeof a.UNSAFE_componentWillReceiveProps != "function" && typeof a.componentWillReceiveProps != "function" || (o !== d || f !== c) && nr(t, a, r, c), $u = !1, f = t.memoizedState, a.state = f, Et(t, r, a, i), Tt();
				var p = t.memoizedState;
				o !== d || f !== p || $u || e !== null && e.dependencies !== null && Ie(e.dependencies) ? (typeof s == "function" && (er(t, n, s, r), p = t.memoizedState), (u = $u || tr(t, n, u, r, f, p, c) || e !== null && e.dependencies !== null && Ie(e.dependencies)) ? (l || typeof a.UNSAFE_componentWillUpdate != "function" && typeof a.componentWillUpdate != "function" || (typeof a.componentWillUpdate == "function" && a.componentWillUpdate(r, p, c), typeof a.UNSAFE_componentWillUpdate == "function" && a.UNSAFE_componentWillUpdate(r, p, c)), typeof a.componentDidUpdate == "function" && (t.flags |= 4), typeof a.getSnapshotBeforeUpdate == "function" && (t.flags |= 1024)) : (typeof a.componentDidUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 4), typeof a.getSnapshotBeforeUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 1024), t.memoizedProps = r, t.memoizedState = p), a.props = r, a.state = p, a.context = c, r = u) : (typeof a.componentDidUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 4), typeof a.getSnapshotBeforeUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 1024), r = !1);
			}
			return a = r, br(e, t), r = !!(t.flags & 128), a || r ? (a = t.stateNode, n = r && typeof n.getDerivedStateFromError != "function" ? null : a.render(), t.flags |= 1, e !== null && r ? (t.child = Ju(t, e.child, null, i), t.child = Ju(t, null, n, i)) : ur(e, t, n, i), t.memoizedState = a.state, e = t.child) : e = Rr(e, t, i), e;
		}
		function wr(e, t, n, r) {
			return Oe(), t.flags |= 256, ur(e, t, n, r), t.child;
		}
		function Tr(e) {
			return {
				baseLanes: e,
				cachePool: nt()
			};
		}
		function Er(e, t, n) {
			return e = e === null ? 0 : e.childLanes & ~n, t && (e |= af), e;
		}
		function Dr(e, t, n) {
			var r = t.pendingProps, i = !1, a = !!(t.flags & 128), o;
			if ((o = a) || (o = e !== null && e.memoizedState === null ? !1 : !!(ad.current & 2)), o && (i = !0, t.flags &= -129), o = !!(t.flags & 32), t.flags &= -33, e === null) {
				if (G) {
					if (i ? Mt(t) : Ft(), (e = _u) ? (e = Vc(e, yu), e !== null && (t.memoizedState = {
						dehydrated: e,
						treeContext: lu === null ? null : {
							id: uu,
							overflow: du
						},
						retryLane: 536870912,
						hydrationErrors: null
					}, n = ho(e), n.return = t, t.child = n, gu = t, _u = null)) : e = null, e === null) throw we(t);
					return t.lanes = Ec(e) ? 32 : 536870912, null;
				}
				return a = r.children, r = r.fallback, i ? (Ft(), i = t.mode, a = kr({
					mode: "hidden",
					children: a
				}, i), r = po(r, i, n, null), a.return = t, r.return = t, a.sibling = r, t.child = a, r = t.child, r.memoizedState = Tr(n), r.childLanes = Er(e, o, n), t.memoizedState = Sd, hr(null, r)) : (Mt(t), Or(t, a));
			}
			var s = e.memoizedState;
			if (s !== null) {
				var c = s.dehydrated;
				if (c !== null) return jr(e, t, a, o, r, c, s, n);
			}
			return i ? (Ft(), i = r.fallback, a = t.mode, s = e.child, c = s.sibling, r = uo(s, {
				mode: "hidden",
				children: r.children
			}), r.subtreeFlags = s.subtreeFlags & 1206910976, c === null ? (i = po(i, a, n, null), i.flags |= 2) : i = uo(c, i), i.return = t, r.return = t, r.sibling = i, t.child = r, hr(null, r), r = t.child, i = e.child.memoizedState, i === null ? i = Tr(n) : (a = i.cachePool, a === null ? a = nt() : (s = us ? Du._currentValue : Du._currentValue2, a = a.parent === s ? a : {
				parent: s,
				pool: s
			}), i = {
				baseLanes: i.baseLanes | n,
				cachePool: a
			}), r.memoizedState = i, r.childLanes = Er(e, o, n), t.memoizedState = Sd, hr(e.child, r)) : (Mt(t), n = e.child, e = n.sibling, n = uo(n, {
				mode: "visible",
				children: r.children
			}), n.return = t, n.sibling = null, e !== null && (o = t.deletions, o === null ? (t.deletions = [e], t.flags |= 16) : o.push(e)), t.child = n, t.memoizedState = null, n);
		}
		function Or(e, t) {
			return t = kr({
				mode: "visible",
				children: t
			}, e.mode), t.return = e, e.child = t;
		}
		function kr(e, n) {
			return e = t(22, e, null, n), e.lanes = 0, e;
		}
		function Ar(e, t, n) {
			return Ju(t, e.child, null, n), e = Or(t, t.pendingProps.children), e.flags |= 2, t.memoizedState = null, e;
		}
		function jr(e, t, n, i, a, o, s, c) {
			if (n) return t.flags & 256 ? (Mt(t), t.flags &= -257, Ar(e, t, c)) : t.memoizedState === null ? (Ft(), o = a.fallback, s = t.mode, a = kr({
				mode: "visible",
				children: a.children
			}, s), o = po(o, s, c, null), o.flags |= 2, a.return = t, o.return = t, a.sibling = o, t.child = a, Ju(t, e.child, null, c), a = t.child, a.memoizedState = Tr(c), a.childLanes = Er(e, i, c), t.memoizedState = Sd, hr(null, a)) : (Ft(), t.child = e.child, t.flags |= 128, null);
			if (Mt(t), Ec(o)) return i = Dc(o).digest, i !== "" && (a = Error(r(419)), a.stack = "", a.digest = i, Ae({
				value: a,
				source: null,
				stack: null
			})), Ar(e, t, c);
			if (xd || Fe(e, t, c, !1), i = (c & e.childLanes) !== 0, xd || i) {
				if (td.current !== null) return Ar(e, t, c);
				if (i = X, i !== null && (a = re(i, c), a !== 0 && a !== s.retryLane)) throw s.retryLane = a, gt(e, a), Ta(i, e, a), bd;
				return Tc(o) || La(), Ar(e, t, c);
			}
			return Tc(o) ? (t.flags |= 192, t.child = e.child, null) : (e = s.treeContext, fs && (_u = Ic(o), gu = t, G = !0, vu = null, yu = !1, e !== null && ye(t, e)), t = Or(t, a.children), t.flags |= 134221824, t);
		}
		function Mr(e, t, n) {
			e.lanes |= t;
			var r = e.alternate;
			r !== null && (r.lanes |= t), Ne(e.return, t, n);
		}
		function Nr(e) {
			for (var t = null; e !== null;) {
				var n = e.alternate;
				n !== null && zt(n) === null && (t = e), e = e.sibling;
			}
			return t;
		}
		function Pr(e, t, n, r, i, a) {
			var o = e.memoizedState;
			o === null ? e.memoizedState = {
				isBackwards: t,
				rendering: null,
				renderingStartTime: 0,
				last: r,
				tail: n,
				tailMode: i,
				treeForkCount: a
			} : (o.isBackwards = t, o.rendering = null, o.renderingStartTime = 0, o.last = r, o.tail = n, o.tailMode = i, o.treeForkCount = a);
		}
		function Fr(e) {
			var t = e.child;
			for (e.child = null; t !== null;) {
				var n = t.sibling;
				t.sibling = e.child, e.child = t, t = n;
			}
		}
		function Ir(e, t, n) {
			var r = t.pendingProps, i = r.revealOrder, a = r.tail;
			r = r.children;
			var o = ad.current;
			if (t.flags & 128) return Lt(t, o), null;
			var s = !!(o & 2);
			if (s ? (o = o & 1 | 2, t.flags |= 128) : o &= 1, Lt(t, o), i === "backwards" && e !== null ? (Fr(e), ur(e, t, r, n), Fr(e)) : ur(e, t, r, n), r = G ? ou : 0, !s && e !== null && e.flags & 128) a: for (e = t.child; e !== null;) {
				if (e.tag === 13) e.memoizedState !== null && Mr(e, n, t);
				else if (e.tag === 19) Mr(e, n, t);
				else if (e.child !== null) {
					e.child.return = e, e = e.child;
					continue;
				}
				if (e === t) break a;
				for (; e.sibling === null;) {
					if (e.return === null || e.return === t) break a;
					e = e.return;
				}
				e.sibling.return = e.return, e = e.sibling;
			}
			switch (i) {
				case "backwards":
					n = Nr(t.child), n === null ? (i = t.child, t.child = null) : (i = n.sibling, n.sibling = null, Fr(t)), Pr(t, !0, i, null, a, r);
					break;
				case "unstable_legacy-backwards":
					for (n = null, i = t.child, t.child = null; i !== null;) {
						if (e = i.alternate, e !== null && zt(e) === null) {
							t.child = i;
							break;
						}
						e = i.sibling, i.sibling = n, n = i, i = e;
					}
					Pr(t, !0, n, null, a, r);
					break;
				case "together":
					Pr(t, !1, null, null, void 0, r);
					break;
				case "independent":
					t.memoizedState = null;
					break;
				default: n = Nr(t.child), n === null ? (i = t.child, t.child = null) : (i = n.sibling, n.sibling = null), Pr(t, !1, i, n, a, r);
			}
			return t.child;
		}
		function Lr(e, t, n) {
			var r = t.pendingProps;
			return je(t, t.type, r.value), ur(e, t, r.children, n), t.child;
		}
		function Rr(e, t, n) {
			if (e !== null && (t.dependencies = e.dependencies), tf |= t.lanes, (n & t.childLanes) === 0) {
				if (e !== null) {
					if (Fe(e, t, n, !1), (n & t.childLanes) === 0) return null;
				} else return null;
			}
			if (e !== null && t.child !== e.child) throw Error(r(153));
			if (t.child !== null) {
				for (e = t.child, n = uo(e, e.pendingProps), t.child = n, n.return = t; e.sibling !== null;) e = e.sibling, n = n.sibling = uo(e, e.pendingProps), n.return = t;
				n.sibling = null;
			}
			return t.child;
		}
		function zr(e, t) {
			return (e.lanes & t) !== 0 || (e = e.dependencies, !!(e !== null && Ie(e)));
		}
		function Br(e, t, n) {
			switch (t.tag) {
				case 3:
					be(t, t.stateNode.containerInfo), je(t, Du, e.memoizedState.cache), Oe();
					break;
				case 27:
				case 5:
					Se(t);
					break;
				case 4:
					be(t, t.stateNode.containerInfo);
					break;
				case 10:
					je(t, t.type, t.memoizedProps.value);
					break;
				case 31:
					if (t.memoizedState !== null) return t.flags |= 128, Nt(t), null;
					break;
				case 13:
					var r = t.memoizedState;
					if (r !== null) {
						if (r.dehydrated !== null) return Mt(t), t.flags |= 128, null;
						r = Fe(e, t, n, !1);
						var i = t.child.childLanes;
						return r || (n & i) !== 0 ? Dr(e, t, n) : (Mt(t), e = Rr(e, t, n), e === null ? null : e.sibling);
					}
					Mt(t);
					break;
				case 19:
					if (t.flags & 128) return Ir(e, t, n);
					if (i = !!(e.flags & 128), r = (n & t.childLanes) !== 0, r ||= (Fe(e, t, n, !1), (n & t.childLanes) !== 0), i) {
						if (r) return Ir(e, t, n);
						t.flags |= 128;
					}
					if (i = t.memoizedState, i !== null && (i.rendering = null, i.tail = null, i.lastEffect = null), Lt(t, ad.current), r) break;
					return null;
				case 22: return t.lanes = 0, mr(e, t, n, t.pendingProps);
				case 24: je(t, Du, e.memoizedState.cache);
			}
			return Rr(e, t, n);
		}
		function Vr(e, t, n) {
			if (e !== null) {
				if (e.memoizedProps !== t.pendingProps) xd = !0;
				else {
					if (!zr(e, n) && !(t.flags & 128)) return xd = !1, Br(e, t, n);
					xd = !!(e.flags & 131072);
				}
			} else xd = !1, G && t.flags & 1048576 && ge(t, ou, t.index);
			switch (t.lanes = 0, t.tag) {
				case 16:
					a: {
						var i = t.pendingProps;
						if (e = ot(t.elementType), t.type = e, typeof e == "function") lo(e) ? (i = rr(e, i), t.tag = 1, t = Cr(null, t, e, i, n)) : (t.tag = 0, t = xr(null, t, e, i, n));
						else {
							if (e != null) {
								var a = e.$$typeof;
								if (a === Po) {
									t.tag = 11, t = dr(null, t, e, i, n);
									break a;
								}
								if (a === Lo) {
									t.tag = 14, t = fr(null, t, e, i, n);
									break a;
								}
								if (a === No) {
									t.tag = 10, t.type = e, t = Lr(null, t, n);
									break a;
								}
							}
							throw t = d(e) || e, Error(r(306, t, ""));
						}
					}
					return t;
				case 0: return xr(e, t, t.type, t.pendingProps, n);
				case 1: return i = t.type, a = rr(i, t.pendingProps), Cr(e, t, i, a, n);
				case 3:
					a: {
						if (be(t, t.stateNode.containerInfo), e === null) throw Error(r(387));
						var o = t.pendingProps;
						a = t.memoizedState, i = a.element, bt(e, t), Et(t, o, null, n);
						var s = t.memoizedState;
						if (o = s.cache, je(t, Du, o), o !== a.cache && Pe(t, [Du], n, !0), Tt(), o = s.element, fs && a.isDehydrated) {
							if (a = {
								element: o,
								isDehydrated: !1,
								cache: s.cache
							}, t.updateQueue.baseState = a, t.memoizedState = a, t.flags & 256) {
								t = wr(e, t, o, n);
								break a;
							}
							if (o !== i) {
								i = me(Error(r(424)), t), Ae(i), t = wr(e, t, o, n);
								break a;
							}
							for (fs && (_u = Pc(t.stateNode.containerInfo), gu = t, G = !0, vu = null, yu = !0), n = Yu(t, null, o, n), t.child = n; n;) n.flags = n.flags & -3 | 134221824, n = n.sibling;
						} else {
							if (Oe(), o === i) {
								t = Rr(e, t, n);
								break a;
							}
							ur(e, t, o, n);
						}
						t = t.child;
					}
					return t;
				case 26: if (sl) return br(e, t), e === null ? (n = ul(t.type, null, t.pendingProps, null)) ? t.memoizedState = n : G || (t.stateNode = gl(t.type, t.pendingProps, mu.current, t)) : t.memoizedState = ul(t.type, e.memoizedProps, t.pendingProps, e.memoizedState), null;
				case 27: if (xl) return Se(t), e === null && xl && G && (i = t.stateNode = Sl(t.type, t.pendingProps, mu.current, fu.current, !1), gu = t, yu = !0, _u = Lc(t.type, i, _u)), ur(e, t, t.pendingProps.children, n), br(e, t), e === null && (t.flags |= 4194304), t.child;
				case 5: return e === null && G && (al(t.type, t.pendingProps, fu.current), (a = i = _u) && (i = Rc(i, t.type, t.pendingProps, yu), i === null ? a = !1 : (t.stateNode = i, gu = t, _u = Nc(i), yu = !1, a = !0)), a || we(t)), Se(t), a = t.type, o = t.pendingProps, s = e === null ? null : e.memoizedProps, i = o.children, as(a, o) ? i = null : s !== null && as(a, s) && (t.flags |= 32), t.memoizedState !== null && (a = Ht(e, t, Gt, null, null, n), us ? ks._currentValue = a : ks._currentValue2 = a), br(e, t), ur(e, t, i, n), t.child;
				case 6: return e === null && G && (ol(t.pendingProps, fu.current), (e = n = _u) && (n = zc(n, t.pendingProps, yu), n === null ? e = !1 : (t.stateNode = n, gu = t, _u = null, e = !0)), e || we(t)), null;
				case 13: return Dr(e, t, n);
				case 4: return be(t, t.stateNode.containerInfo), i = t.pendingProps, e === null ? t.child = Ju(t, null, i, n) : ur(e, t, i, n), t.child;
				case 11: return dr(e, t, t.type, t.pendingProps, n);
				case 7: return i = t.pendingProps, br(e, t), ur(e, t, i, n), t.child;
				case 8: return ur(e, t, t.pendingProps.children, n), t.child;
				case 12: return ur(e, t, t.pendingProps.children, n), t.child;
				case 10: return Lr(e, t, n);
				case 9: return a = t.type._context, i = t.pendingProps.children, Le(t), a = Re(a), i = i(a), t.flags |= 1, ur(e, t, i, n), t.child;
				case 14: return fr(e, t, t.type, t.pendingProps, n);
				case 15: return pr(e, t, t.type, t.pendingProps, n);
				case 19: return Ir(e, t, n);
				case 31: return yr(e, t, n);
				case 22: return mr(e, t, n, t.pendingProps);
				case 24: return Le(t), i = Re(Du), e === null ? (a = et(), a === null && (a = X, o = Ve(), a.pooledCache = o, o.refCount++, o !== null && (a.pooledCacheLanes |= n), a = o), t.memoizedState = {
					parent: i,
					cache: a
				}, yt(t), je(t, Du, a)) : ((e.lanes & n) !== 0 && (bt(e, t), Et(t, null, null, n), Tt()), a = e.memoizedState, o = t.memoizedState, a.parent === i ? (i = o.cache, je(t, Du, i), i !== a.cache && Pe(t, [Du], n, !0)) : (a = {
					parent: i,
					cache: i
				}, t.memoizedState = a, t.lanes === 0 && (t.memoizedState = t.updateQueue.baseState = a), je(t, Du, i))), ur(e, t, t.pendingProps.children, n), t.child;
				case 30: return t.stateNode === null && (t.stateNode = {
					autoName: null,
					paired: null,
					clones: null,
					ref: null
				}), i = t.pendingProps, i.name != null && i.name !== "auto" ? t.flags |= e === null ? 18882560 : 18874368 : G && _e(t), e !== null && e.memoizedProps.name !== i.name ? t.flags |= 4194816 : br(e, t), ur(e, t, i.children, n), t.child;
				case 29: throw t.pendingProps;
			}
			throw Error(r(156, t.tag));
		}
		function Hr(e) {
			e.flags |= 4;
		}
		function Ur(e) {
			ds && (e.flags |= 8);
		}
		function Wr(e, t) {
			if (e !== null && e.child === t.child) return !1;
			if (t.flags & 16) return !0;
			for (e = t.child; e !== null;) {
				if (e.flags & 8218 || e.subtreeFlags & 8218) return !0;
				e = e.sibling;
			}
			return !1;
		}
		function Gr(e, t, n, r) {
			if (V) for (n = t.child; n !== null;) {
				if (n.tag === 5 || n.tag === 6) rs(e, n.stateNode);
				else if (!(n.tag === 4 || xl && n.tag === 27) && n.child !== null) {
					n.child.return = n, n = n.child;
					continue;
				}
				if (n === t) break;
				for (; n.sibling === null;) {
					if (n.return === null || n.return === t) return;
					n = n.return;
				}
				n.sibling.return = n.return, n = n.sibling;
			}
			else if (ds) for (var i = t.child; i !== null;) {
				if (i.tag === 5) {
					var a = i.stateNode;
					n && r && (a = Cc(a, i.type, i.memoizedProps)), rs(e, a);
				} else if (i.tag === 6) a = i.stateNode, n && r && (a = wc(a, i.memoizedProps)), rs(e, a);
				else if (i.tag !== 4) {
					if (i.tag === 22 && i.memoizedState !== null) a = i.child, a !== null && (a.return = i), Gr(e, i, !0, !0);
					else if (i.child !== null) {
						i.child.return = i, i = i.child;
						continue;
					}
				}
				if (i === t) break;
				for (; i.sibling === null;) {
					if (i.return === null || i.return === t) return;
					i = i.return;
				}
				i.sibling.return = i.return, i = i.sibling;
			}
		}
		function Kr(e, t, n, r) {
			var i = !1;
			if (ds) for (var a = t.child; a !== null;) {
				if (a.tag === 5) {
					var o = a.stateNode;
					n && r && (o = Cc(o, a.type, a.memoizedProps)), bc(e, o);
				} else if (a.tag === 6) o = a.stateNode, n && r && (o = wc(o, a.memoizedProps)), bc(e, o);
				else if (a.tag !== 4) {
					if (a.tag === 22 && a.memoizedState !== null) i = a.child, i !== null && (i.return = a), Kr(e, a, !0, !0), i = !0;
					else if (a.child !== null) {
						a.child.return = a, a = a.child;
						continue;
					}
				}
				if (a === t) break;
				for (; a.sibling === null;) {
					if (a.return === null || a.return === t) return i;
					a = a.return;
				}
				a.sibling.return = a.return, a = a.sibling;
			}
			return i;
		}
		function qr(e, t) {
			if (ds && Wr(e, t)) {
				e = t.stateNode;
				var n = e.containerInfo, r = yc();
				Kr(r, t, !1, !1), e.pendingChildren = r, Hr(t), xc(n, r);
			}
		}
		function Jr(e, t, n, r) {
			if (V) e.memoizedProps !== r && Hr(t);
			else if (ds) {
				var i = e.stateNode, a = e.memoizedProps;
				if ((e = Wr(e, t)) || a !== r) {
					var o = fu.current;
					a = vc(i, n, a, r, !e, null), a === i ? t.stateNode = i : (Ur(t), is(a, n, r, o) && Hr(t), t.stateNode = a, e && Gr(a, t, !1, !1));
				} else t.stateNode = i;
			}
		}
		function Yr(e, t, n, r, i) {
			if (e.mode & 32 && (n === null ? bs(t, r) : xs(t, n, r))) {
				if (e.flags |= 16777216, (i & 335544128) === i || Ss(t, r)) {
					if (Cs(e.stateNode, t, r)) e.flags |= 8192;
					else if (Pa()) e.flags |= 8192;
					else throw Gu = Wu, Hu;
				}
			} else e.flags &= -16777217;
		}
		function Xr(e, t) {
			if (vl(t)) {
				if (e.flags |= 16777216, !yl(t)) {
					if (Pa()) e.flags |= 8192;
					else throw Gu = Wu, Hu;
				}
			} else e.flags &= -16777217;
		}
		function Zr(e, t) {
			t !== null && (e.flags |= 4), e.flags & 16384 && (t = e.tag === 22 ? 536870912 : te(), e.lanes |= t, of |= t);
		}
		function Qr(e, t) {
			if (!G) switch (e.tailMode) {
				case "visible": break;
				case "collapsed":
					for (var n = e.tail, r = null; n !== null;) n.alternate !== null && (r = n), n = n.sibling;
					r === null ? t || e.tail === null ? e.tail = null : e.tail.sibling = null : r.sibling = null;
					break;
				default:
					for (t = e.tail, n = null; t !== null;) t.alternate !== null && (n = t), t = t.sibling;
					n === null ? e.tail = null : n.sibling = null;
			}
		}
		function j(e) {
			var t = e.alternate !== null && e.alternate.child === e.child, n = 0, r = 0;
			if (t) for (var i = e.child; i !== null;) n |= i.lanes | i.childLanes, r |= i.subtreeFlags & 1206910976, r |= i.flags & 1206910976, i.return = e, i = i.sibling;
			else for (i = e.child; i !== null;) n |= i.lanes | i.childLanes, r |= i.subtreeFlags, r |= i.flags, i.return = e, i = i.sibling;
			return e.subtreeFlags |= r, e.childLanes = n, t;
		}
		function $r(e, t, n) {
			var i = t.pendingProps;
			switch (ve(t), t.tag) {
				case 16:
				case 15:
				case 0:
				case 11:
				case 7:
				case 8:
				case 12:
				case 9:
				case 14: return j(t), null;
				case 1: return j(t), null;
				case 3: return n = t.stateNode, i = null, e !== null && (i = e.memoizedState.cache), t.memoizedState.cache !== i && (t.flags |= 2048), Me(Du), xe(), n.pendingContext && (n.context = n.pendingContext, n.pendingContext = null), (e === null || e.child === null) && (De(t) ? Hr(t) : e === null || e.memoizedState.isDehydrated && !(t.flags & 256) || (t.flags |= 1024, ke())), qr(e, t), j(t), null;
				case 26: if (sl) {
					var a = t.type, o = t.memoizedState;
					return e === null ? (Hr(t), o === null ? (j(t), Yr(t, a, null, i, n)) : (j(t), Xr(t, o))) : o ? o === e.memoizedState ? (j(t), t.flags &= -16777217) : (Hr(t), j(t), Xr(t, o)) : (o = e.memoizedProps, V ? o !== i && Hr(t) : Jr(e, t, a, i), j(t), Yr(t, a, o, i, n)), null;
				}
				case 27: if (xl) {
					if (Ce(t), n = mu.current, a = t.type, e !== null && t.stateNode != null) V ? e.memoizedProps !== i && Hr(t) : Jr(e, t, a, i);
					else {
						if (!i) {
							if (t.stateNode === null) throw Error(r(166));
							return j(t), t.subtreeFlags &= -33554433, null;
						}
						e = fu.current, De(t) ? Te(t, e) : (e = Sl(a, i, n, e, !0), t.stateNode = e, Hr(t));
					}
					return j(t), t.subtreeFlags &= -33554433, null;
				}
				case 5:
					if (Ce(t), a = t.type, e !== null && t.stateNode != null) Jr(e, t, a, i);
					else {
						if (!i) {
							if (t.stateNode === null) throw Error(r(166));
							return j(t), t.subtreeFlags &= -33554433, null;
						}
						if (o = fu.current, De(t)) Te(t, o), Qc(t.stateNode, a, i, o) && (t.flags |= 64);
						else {
							var s = ns(a, i, mu.current, o, t);
							Ur(t), Gr(s, t, !1, !1), t.stateNode = s, is(s, a, i, o) && Hr(t);
						}
					}
					return j(t), t.subtreeFlags &= -33554433, Yr(t, t.type, e === null ? null : e.memoizedProps, t.pendingProps, n), null;
				case 6:
					if (e && t.stateNode != null) n = e.memoizedProps, V ? n !== i && Hr(t) : ds && (n === i ? t.stateNode = e.stateNode : (e = mu.current, n = fu.current, Ur(t), t.stateNode = os(i, e, n, t)));
					else {
						if (typeof i != "string" && t.stateNode === null) throw Error(r(166));
						if (e = mu.current, n = fu.current, De(t)) {
							if (!fs) throw Error(r(176));
							if (e = t.stateNode, n = t.memoizedProps, i = null, a = gu, a !== null) switch (a.tag) {
								case 27:
								case 5: i = a.memoizedProps;
							}
							Uc(e, n, t, i) || we(t, !0);
						} else Ur(t), t.stateNode = os(i, e, n, t);
					}
					return j(t), null;
				case 31:
					if (n = t.memoizedState, e === null || e.memoizedState !== null) {
						if (i = De(t), n !== null) {
							if (e === null) {
								if (!i) throw Error(r(318));
								if (!fs) throw Error(r(556));
								if (e = t.memoizedState, e = e === null ? null : e.dehydrated, !e) throw Error(r(557));
								Wc(e, t);
							} else Oe(), !(t.flags & 128) && (t.memoizedState = null), t.flags |= 4;
							j(t), e = !1;
						} else n = ke(), e !== null && e.memoizedState !== null && (e.memoizedState.hydrationErrors = n), e = !0;
						if (!e) return t.flags & 256 ? (It(t), t) : (It(t), null);
						if (t.flags & 128) throw Error(r(558));
					}
					return j(t), null;
				case 13:
					if (i = t.memoizedState, e === null || e.memoizedState !== null && e.memoizedState.dehydrated !== null) {
						if (a = De(t), i !== null && i.dehydrated !== null) {
							if (e === null) {
								if (!a) throw Error(r(318));
								if (!fs) throw Error(r(344));
								if (a = t.memoizedState, a = a === null ? null : a.dehydrated, !a) throw Error(r(317));
								Gc(a, t);
							} else Oe(), !(t.flags & 128) && (t.memoizedState = null), t.flags |= 4;
							j(t), a = !1;
						} else a = ke(), e !== null && e.memoizedState !== null && (e.memoizedState.hydrationErrors = a), a = !0;
						if (!a) return t.flags & 256 ? (It(t), t) : (It(t), null);
					}
					return It(t), t.flags & 128 ? (t.lanes = n, t) : (n = i !== null, e = e !== null && e.memoizedState !== null, n && (i = t.child, a = null, i.alternate !== null && i.alternate.memoizedState !== null && i.alternate.memoizedState.cachePool !== null && (a = i.alternate.memoizedState.cachePool.pool), o = null, i.memoizedState !== null && i.memoizedState.cachePool !== null && (o = i.memoizedState.cachePool.pool), o !== a && (i.flags |= 2048)), n !== e && n && (t.child.flags |= 8192), Zr(t, t.updateQueue), j(t), null);
				case 4: return xe(), qr(e, t), e === null && ms(t.stateNode.containerInfo), t.flags |= 67108864, j(t), null;
				case 10: return Me(t.type), j(t), null;
				case 19:
					if (Rt(t), i = t.memoizedState, i === null) return j(t), null;
					if (a = !!(t.flags & 128), o = i.rendering, o === null) {
						if (a) Qr(i, !1);
						else {
							if (ef !== 0 || e !== null && e.flags & 128) for (e = t.child; e !== null;) {
								if (o = zt(e), o !== null) {
									for (t.flags |= 128, Qr(i, !1), e = o.updateQueue, t.updateQueue = e, Zr(t, e), t.subtreeFlags = 0, e = n, n = t.child; n !== null;) fo(n, e), n = n.sibling;
									return Lt(t, ad.current & 1 | 2), G && he(t, i.treeForkCount), t.child;
								}
								e = e.sibling;
							}
							i.tail !== null && Bl() > ff && (t.flags |= 128, a = !0, Qr(i, !1), t.lanes = 4194304);
						}
					} else {
						if (!a) {
							if (e = zt(o), e !== null) {
								if (t.flags |= 128, a = !0, e = e.updateQueue, t.updateQueue = e, Zr(t, e), Qr(i, !0), i.tail === null && i.tailMode !== "collapsed" && i.tailMode !== "visible" && !o.alternate && !G) return j(t), null;
							} else 2 * Bl() - i.renderingStartTime > ff && n !== 536870912 && (t.flags |= 128, a = !0, Qr(i, !1), t.lanes = 4194304);
						}
						i.isBackwards ? (o.sibling = t.child, t.child = o) : (e = i.last, e === null ? t.child = o : e.sibling = o, i.last = o);
					}
					if (i.tail !== null) {
						e = i.tail;
						a: {
							for (n = e; n !== null;) {
								if (n.alternate !== null) {
									n = !1;
									break a;
								}
								n = n.sibling;
							}
							n = !0;
						}
						return i.rendering = e, i.tail = e.sibling, i.renderingStartTime = Bl(), e.sibling = null, o = ad.current, o = a ? o & 1 | 2 : o & 1, i.tailMode === "visible" || i.tailMode === "collapsed" || !n || G ? Lt(t, o) : (n = o, m(rd, t), m(ad, n), id === null && (id = t)), G && he(t, i.treeForkCount), e;
					}
					return j(t), null;
				case 22:
				case 23: return It(t), jt(), i = t.memoizedState !== null, e === null ? i && (t.flags |= 8192) : e.memoizedState !== null !== i && (t.flags |= 8192), i ? n & 536870912 && !(t.flags & 128) && (j(t), t.subtreeFlags & 6 && (t.flags |= 8192)) : j(t), n = t.updateQueue, n !== null && Zr(t, n.retryQueue), n = null, e !== null && e.memoizedState !== null && e.memoizedState.cachePool !== null && (n = e.memoizedState.cachePool.pool), i = null, t.memoizedState !== null && t.memoizedState.cachePool !== null && (i = t.memoizedState.cachePool.pool), i !== n && (t.flags |= 2048), e !== null && p(Bu), null;
				case 24: return n = null, e !== null && (n = e.memoizedState.cache), t.memoizedState.cache !== n && (t.flags |= 2048), Me(Du), j(t), null;
				case 25: return null;
				case 30: return t.flags |= 33554432, j(t), null;
			}
			throw Error(r(156, t.tag));
		}
		function ei(e, t) {
			switch (ve(t), t.tag) {
				case 1: return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
				case 3: return Me(Du), xe(), e = t.flags, e & 65536 && !(e & 128) ? (t.flags = e & -65537 | 128, t) : null;
				case 26:
				case 27:
				case 5: return Ce(t), null;
				case 31:
					if (t.memoizedState !== null) {
						if (It(t), t.alternate === null) throw Error(r(340));
						Oe();
					}
					return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
				case 13:
					if (It(t), e = t.memoizedState, e !== null && e.dehydrated !== null) {
						if (t.alternate === null) throw Error(r(340));
						Oe();
					}
					return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
				case 19: return Rt(t), e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, e = t.memoizedState, e !== null && (e.rendering = null, e.tail = null), t.flags |= 4, t) : null;
				case 4: return xe(), null;
				case 10: return Me(t.type), null;
				case 22:
				case 23: return It(t), jt(), e !== null && p(Bu), e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
				case 24: return Me(Du), null;
				case 25: return null;
				default: return null;
			}
		}
		function ti(e, t) {
			switch (ve(t), t.tag) {
				case 3:
					Me(Du), xe();
					break;
				case 26:
				case 27:
				case 5:
					Ce(t);
					break;
				case 4:
					xe();
					break;
				case 31:
					t.memoizedState !== null && It(t);
					break;
				case 13:
					It(t);
					break;
				case 19:
					Rt(t);
					break;
				case 10:
					Me(t.type);
					break;
				case 22:
				case 23:
					It(t), jt(), e !== null && p(Bu);
					break;
				case 24: Me(Du);
			}
		}
		function ni(e, t) {
			try {
				var n = t.updateQueue, r = n === null ? null : n.lastEffect;
				if (r !== null) {
					var i = r.next;
					n = i;
					do {
						if ((n.tag & e) === e) {
							r = void 0;
							var a = n.create, o = n.inst;
							r = a(), o.destroy = r;
						}
						n = n.next;
					} while (n !== i);
				}
			} catch (e) {
				P(t, t.return, e);
			}
		}
		function ri(e, t, n) {
			try {
				var r = t.updateQueue, i = r === null ? null : r.lastEffect;
				if (i !== null) {
					var a = i.next;
					r = a;
					do {
						if ((r.tag & e) === e) {
							var o = r.inst, s = o.destroy;
							if (s !== void 0) {
								o.destroy = void 0, i = t;
								var c = n, l = s;
								try {
									l();
								} catch (e) {
									P(i, c, e);
								}
							}
						}
						r = r.next;
					} while (r !== a);
				}
			} catch (e) {
				P(t, t.return, e);
			}
		}
		function ii(e) {
			var t = e.updateQueue;
			if (t !== null) {
				var n = e.stateNode;
				try {
					Ot(t, n);
				} catch (t) {
					P(e, e.return, t);
				}
			}
		}
		function ai(e, t, n) {
			n.props = rr(e.type, e.memoizedProps), n.state = e.memoizedState;
			try {
				n.componentWillUnmount();
			} catch (n) {
				P(e, t, n);
			}
		}
		function oi(e, t) {
			try {
				var n = e.ref;
				if (n !== null) {
					switch (e.tag) {
						case 26:
						case 27:
						case 5:
							var r = Zo(e.stateNode);
							break;
						case 30:
							var i = e.stateNode, a = se(e.memoizedProps, i);
							(i.ref === null || i.ref.name !== a) && (i.ref = fc(a)), r = i.ref;
							break;
						case 7:
							e.stateNode === null && (e.stateNode = mc(e)), r = e.stateNode;
							break;
						default: r = e.stateNode;
					}
					typeof n == "function" ? e.refCleanup = n(r) : n.current = r;
				}
			} catch (n) {
				P(e, t, n);
			}
		}
		function si(e, t) {
			var n = e.ref, r = e.refCleanup;
			if (n !== null) {
				if (typeof r == "function") try {
					r();
				} catch (n) {
					P(e, t, n);
				} finally {
					e.refCleanup = null, e = e.alternate, e != null && (e.refCleanup = null);
				}
				else if (typeof n == "function") try {
					n(null);
				} catch (n) {
					P(e, t, n);
				}
				else n.current = null;
			}
		}
		function ci() {
			var e = Cd;
			return Cd = !1, e;
		}
		function li(e, t) {
			if ((e.tag === 5 || e.tag === 27 || e.tag === 6) && e.alternate === null && t !== null) for (var n = 0; n < t.length; n++) gc(e.stateNode, t[n]);
		}
		function ui(e) {
			for (var t = e.return; t !== null && (fi(t) && gc(e.stateNode, t.stateNode), !di(t));) t = t.return;
		}
		function M(e) {
			for (var t = e.return; t !== null && (fi(t) && _c(e.stateNode, t.stateNode), !di(t));) t = t.return;
		}
		function di(e) {
			return e.tag === 5 || e.tag === 3 || (xl ? e.tag === 27 : !1);
		}
		function fi(e) {
			return e && e.tag === 7 && e.stateNode !== null;
		}
		function pi(e) {
			var t = e.type, n = e.memoizedProps, r = e.stateNode;
			try {
				Gs(r, t, n, e);
			} catch (t) {
				P(e, e.return, t);
			}
		}
		function mi(e, t, n) {
			try {
				Ks(e.stateNode, e.type, n, t, e);
			} catch (t) {
				P(e, e.return, t);
			}
		}
		function hi(e) {
			return e.tag === 5 || e.tag === 3 || (sl ? e.tag === 26 : !1) || (xl ? e.tag === 27 && El(e.type) : !1) || e.tag === 4;
		}
		function gi(e) {
			a: for (;;) {
				for (; e.sibling === null;) {
					if (e.return === null || hi(e.return)) return null;
					e = e.return;
				}
				for (e.sibling.return = e.return, e = e.sibling; e.tag !== 5 && e.tag !== 6 && e.tag !== 18;) {
					if (xl && e.tag === 27 && El(e.type) || e.flags & 2 || e.child === null || e.tag === 4) continue a;
					e.child.return = e, e = e.child;
				}
				if (!(e.flags & 2)) return e.stateNode;
			}
		}
		function _i(e, t, n, r) {
			var i = e.tag;
			if (i === 5 || i === 6) i = e.stateNode, t ? Js(n, i, t) : Hs(n, i), li(e, r), Cd = !0;
			else if (i !== 4 && (xl && i === 27 && (li(e, r), r = null, El(e.type) && (n = e.stateNode, t = null)), e = e.child, e !== null)) for (_i(e, t, n, r), e = e.sibling; e !== null;) _i(e, t, n, r), e = e.sibling;
		}
		function vi(e, t, n, r) {
			var i = e.tag;
			if (i === 5 || i === 6) i = e.stateNode, t ? qs(n, i, t) : Vs(n, i), li(e, r), Cd = !0;
			else if (i !== 4 && (xl && i === 27 && (li(e, r), r = null, El(e.type) && (n = e.stateNode)), e = e.child, e !== null)) for (vi(e, t, n, r), e = e.sibling; e !== null;) vi(e, t, n, r), e = e.sibling;
		}
		function yi(e, t) {
			if (e.tag === 5 || xl && e.tag === 27) li(e, t);
			else if (e.tag !== 4 && (e = e.child, e !== null)) for (yi(e, t), e = e.sibling; e !== null;) yi(e, t), e = e.sibling;
		}
		function bi(e, t, n) {
			e = e.containerInfo;
			try {
				Sc(e, n);
			} catch (e) {
				P(t, t.return, e);
			}
		}
		function xi(e) {
			var t = e.stateNode, n = e.memoizedProps;
			try {
				Cl(e.type, n, t, e);
			} catch (t) {
				P(e, e.return, t);
			}
		}
		function Si(e) {
			(e.tag === 30 || e.subtreeFlags & 33554432) && (wd = !0);
		}
		function Ci() {
			var e = Ed;
			return Ed = null, e;
		}
		function wi(e, t, n, r, i) {
			return Dd = 0, Ti(e.child, t, n, r, i);
		}
		function Ti(e, t, n, r, i) {
			if (!V) return !1;
			for (var a = !1; e !== null;) {
				if (e.tag === 5) {
					var o = e.stateNode;
					if (r !== null) {
						var s = ic(o);
						r.push(s), oc(s) && (a = !0);
					} else a || oc(ic(o)) && (a = !0);
					wd = !0, $s(o, Dd === 0 ? t : t + "_" + Dd, n), Dd++;
				} else (e.tag !== 22 || e.memoizedState === null) && (e.tag === 30 && i || Ti(e.child, t, n, r, i) && (a = !0));
				e = e.sibling;
			}
			return a;
		}
		function Ei(e, t) {
			if (V) for (; e !== null;) e.tag === 5 ? ec(e.stateNode, e.memoizedProps) : (e.tag !== 22 || e.memoizedState === null) && (e.tag === 30 && t || Ei(e.child, t)), e = e.sibling;
		}
		function Di(e) {
			if (e.subtreeFlags & 18874368) for (e = e.child; e !== null;) {
				if ((e.tag !== 22 || e.memoizedState === null) && (Di(e), e.tag === 30 && e.flags & 18874368 && e.stateNode.paired)) {
					var t = e.memoizedProps;
					if (t.name == null || t.name === "auto") throw Error(r(544));
					var n = t.name;
					t = le(t.default, t.share), t !== "none" && (wi(e, n, t, null, !1) || Ei(e.child, !1));
				}
				e = e.sibling;
			}
		}
		function Oi(e, t) {
			if (e.tag === 30) {
				var n = e.stateNode, r = e.memoizedProps, i = se(r, n), a = le(r.default, n.paired ? r.share : r.enter);
				a === "none" ? Di(e) : wi(e, i, a, null, !1) ? (Di(e), n.paired || t || wa(e, r.onEnter)) : Ei(e.child, !1);
			} else if (e.subtreeFlags & 33554432) for (e = e.child; e !== null;) Oi(e, t), e = e.sibling;
			else Di(e);
		}
		function ki(e) {
			if (Td !== null && Td.size !== 0) {
				var t = Td;
				if (e.subtreeFlags & 18874368) for (e = e.child; e !== null;) {
					if (e.tag !== 22 || e.memoizedState === null) {
						if (e.tag === 30 && e.flags & 18874368) {
							var n = e.memoizedProps, r = n.name;
							if (r != null && r !== "auto") {
								var i = t.get(r);
								if (i !== void 0) {
									var a = le(n.default, n.share);
									if (a !== "none" && (wi(e, r, a, null, !1) ? (a = e.stateNode, i.paired = a, a.paired = i, wa(e, n.onShare)) : Ei(e.child, !1)), t.delete(r), t.size === 0) break;
								}
							}
						}
						ki(e);
					}
					e = e.sibling;
				}
			}
		}
		function Ai(e) {
			if (e.tag === 30) {
				var t = e.memoizedProps, n = se(t, e.stateNode), r = Td === null ? void 0 : Td.get(n), i = le(t.default, r === void 0 ? t.exit : t.share);
				i !== "none" && (wi(e, n, i, null, !1) ? r === void 0 ? wa(e, t.onExit) : (i = e.stateNode, r.paired = i, i.paired = r, Td.delete(n), wa(e, t.onShare)) : Ei(e.child, !1)), Td !== null && ki(e);
			} else if (e.subtreeFlags & 33554432) for (e = e.child; e !== null;) Ai(e), e = e.sibling;
			else Td !== null && ki(e);
		}
		function ji(e) {
			for (e = e.child; e !== null;) {
				if (e.tag === 30) {
					var t = e.memoizedProps, n = se(t, e.stateNode);
					t = le(t.default, t.update), e.flags &= -5, t !== "none" && wi(e, n, t, e.memoizedState = [], !1);
				} else e.subtreeFlags & 33554432 && ji(e);
				e = e.sibling;
			}
		}
		function Mi(e) {
			if (e.subtreeFlags & 18874368) for (e = e.child; e !== null;) {
				if (e.tag !== 22 || e.memoizedState === null) {
					if (e.tag === 30 && e.flags & 18874368) {
						var t = e.stateNode;
						t.paired !== null && (t.paired = null, Ei(e.child, !1));
					}
					Mi(e);
				}
				e = e.sibling;
			}
		}
		function Ni(e) {
			if (e.tag === 30) e.stateNode.paired = null, Ei(e.child, !1), Mi(e);
			else if (e.subtreeFlags & 33554432) for (e = e.child; e !== null;) Ni(e), e = e.sibling;
			else Mi(e);
		}
		function Pi(e) {
			for (e = e.child; e !== null;) e.tag === 30 ? Ei(e.child, !1) : e.subtreeFlags & 33554432 && Pi(e), e = e.sibling;
		}
		function Fi(e, t, n, r, i, a, o) {
			if (!V) return !1;
			for (var s = !1; t !== null;) {
				if (t.tag === 5) {
					var c = t.stateNode;
					if (a !== null && Dd < a.length) {
						var l = a[Dd], u = ic(c);
						(oc(l) || oc(u)) && (s = !0), !(e.flags & 4) && sc(l, u) && (e.flags |= 4), cc(l, u) && (e.flags |= 32);
					} else e.flags |= 32;
					e.flags & 4 && $s(c, Dd === 0 ? n : n + "_" + Dd, i), s && e.flags & 4 || (Ed === null && (Ed = []), Ed.push(c, Dd === 0 ? r : r + "_" + Dd, t.memoizedProps)), Dd++;
				} else (t.tag !== 22 || t.memoizedState === null) && (t.tag === 30 && o ? e.flags |= t.flags & 32 : Fi(e, t.child, n, r, i, a, o) && (s = !0));
				t = t.sibling;
			}
			return s;
		}
		function Ii(e, t) {
			for (e = e.child; e !== null;) {
				if (e.tag === 30) {
					var n = e.memoizedProps, r = e.stateNode, i = se(n, r), a = le(n.default, n.update);
					if (t) {
						r = r.clones;
						var o = r === null ? null : r.map(ac);
					} else o = e.memoizedState, e.memoizedState = null;
					r = e;
					var s = e.child;
					Dd = 0, i = Fi(r, s, i, i, a, o, !1), e.flags & 4 && i && (t || wa(e, n.onUpdate));
				} else e.subtreeFlags & 33554432 && Ii(e, t);
				e = e.sibling;
			}
		}
		function Li(e, t, n) {
			for (es(e.containerInfo), e = (n & 335544064) === n, Md = t, t = e ? 9270 : 1024; Md !== null;) {
				if (n = Md, e) {
					var r = n.deletions;
					if (r !== null) for (var i = 0; i < r.length; i++) e && Ai(r[i]);
				}
				if (n.alternate === null && n.flags & 2) e && Si(n), Ri(e);
				else {
					if (n.tag === 22) {
						if (r = n.alternate, n.memoizedState !== null) {
							r !== null && r.memoizedState === null && e && Ai(r), Ri(e);
							continue;
						}
						if (r !== null && r.memoizedState !== null) {
							e && Si(n), Ri(e);
							continue;
						}
					}
					r = n.child, (n.subtreeFlags & t) !== 0 && r !== null ? (r.return = n, Md = r) : (e && ji(n), Ri(e));
				}
			}
			Td = null;
		}
		function Ri(e) {
			for (; Md !== null;) {
				var t = Md, n = e, i = t.alternate, a = t.flags;
				switch (t.tag) {
					case 0:
					case 11:
					case 15: break;
					case 1:
						if (a & 1024 && i !== null) {
							n = void 0, a = i.memoizedProps, i = i.memoizedState;
							var o = t.stateNode;
							try {
								var s = rr(t.type, a);
								n = o.getSnapshotBeforeUpdate(s, i), o.__reactInternalSnapshotBeforeUpdate = n;
							} catch (e) {
								P(t, t.return, e);
							}
						}
						break;
					case 3:
						a & 1024 && V && pc(t.stateNode.containerInfo);
						break;
					case 5:
					case 26:
					case 27:
					case 6:
					case 4:
					case 17: break;
					case 30:
						n && i !== null && (n = se(i.memoizedProps, i.stateNode), a = t.memoizedProps, a = le(a.default, a.update), a !== "none" && wi(i, n, a, i.memoizedState = [], !0));
						break;
					default: if (a & 1024) throw Error(r(163));
				}
				if (i = t.sibling, i !== null) {
					i.return = t.return, Md = i;
					break;
				}
				Md = t.return;
			}
		}
		function zi(e, t, n) {
			var r = n.flags;
			switch (n.tag) {
				case 0:
				case 11:
				case 15:
					na(e, n), r & 4 && ni(5, n);
					break;
				case 1:
					if (na(e, n), r & 4) {
						if (e = n.stateNode, t === null) try {
							e.componentDidMount();
						} catch (e) {
							P(n, n.return, e);
						}
						else {
							var i = rr(n.type, t.memoizedProps);
							t = t.memoizedState;
							try {
								e.componentDidUpdate(i, t, e.__reactInternalSnapshotBeforeUpdate);
							} catch (e) {
								P(n, n.return, e);
							}
						}
					}
					r & 64 && ii(n), r & 512 && oi(n, n.return);
					break;
				case 3:
					if (na(e, n), r & 64 && (r = n.updateQueue, r !== null)) {
						if (e = null, n.child !== null) switch (n.child.tag) {
							case 27:
							case 5:
								e = Zo(n.child.stateNode);
								break;
							case 1: e = n.child.stateNode;
						}
						try {
							Ot(r, e);
						} catch (e) {
							P(n, n.return, e);
						}
					}
					break;
				case 27: xl && t === null && r & 4 && xi(n);
				case 26:
				case 5:
					if (na(e, n), t === null) {
						if (r & 4) pi(n);
						else if (r & 64) {
							e = n.type, t = n.memoizedProps, i = n.stateNode;
							try {
								Jc(i, e, t, n);
							} catch (e) {
								P(n, n.return, e);
							}
						}
					}
					r & 512 && oi(n, n.return);
					break;
				case 12:
					na(e, n);
					break;
				case 31:
					na(e, n), r & 4 && Ki(e, n);
					break;
				case 13:
					na(e, n), r & 4 && qi(e, n), r & 64 && (r = n.memoizedState, r !== null && (r = r.dehydrated, r !== null && (n = oo.bind(null, n), Oc(r, n))));
					break;
				case 22:
					if (r = n.memoizedState !== null || Od, !r) {
						var a = t !== null && t.memoizedState !== null || J;
						t = Od, i = J, Od = r, (J = a) && !i ? (r = xl ? 2 : 0, n.subtreeFlags & 8772 && (r |= 1), ia(e, n, r)) : na(e, n), Od = t, J = i;
					}
					break;
				case 30:
					na(e, n), r & 512 && oi(n, n.return);
					break;
				case 7: r & 512 && oi(n, n.return);
				default: na(e, n);
			}
		}
		function Bi(e, t) {
			if (V) for (e = e.child; e !== null;) Vi(e, t), e = e.sibling;
		}
		function Vi(e, t) {
			if (V) switch (e.tag) {
				case 5:
				case 26:
					try {
						var n = e.stateNode;
						t ? W(n) : Zs(e.stateNode, e.memoizedProps);
					} catch (t) {
						P(e, e.return, t);
					}
					Hi(e, t);
					break;
				case 6:
					try {
						var r = e.stateNode;
						t ? Xs(r) : Qs(r, e.memoizedProps), Cd = !0;
					} catch (t) {
						P(e, e.return, t);
					}
					break;
				case 18:
					try {
						var i = e.stateNode;
						t ? nl(i) : rl(e.stateNode);
					} catch (t) {
						P(e, e.return, t);
					}
					break;
				case 22:
				case 23:
					e.memoizedState === null && Bi(e, t);
					break;
				default: Bi(e, t);
			}
		}
		function Hi(e, t) {
			if (V && e.subtreeFlags & 67108864) for (e = e.child; e !== null;) {
				var n = e, r = t;
				if (V) switch (n.tag) {
					case 4:
						Vi(n, r);
						break;
					case 22:
						n.memoizedState === null && Hi(n, r);
						break;
					default: Hi(n, r);
				}
				e = e.sibling;
			}
		}
		function Ui(e) {
			var t = e.alternate;
			t !== null && (e.alternate = null, Ui(t)), e.child = null, e.deletions = null, e.sibling = null, e.tag === 5 && (t = e.stateNode, t !== null && ys(t)), e.stateNode = null, e.return = null, e.dependencies = null, e.memoizedProps = null, e.memoizedState = null, e.pendingProps = null, e.stateNode = null, e.updateQueue = null;
		}
		function Wi(e, t, n) {
			for (n = n.child; n !== null;) Gi(e, t, n), n = n.sibling;
		}
		function Gi(e, t, n) {
			if (Jl && typeof Jl.onCommitFiberUnmount == "function") try {
				Jl.onCommitFiberUnmount(ql, n);
			} catch {}
			switch (n.tag) {
				case 26: if (sl) {
					J || si(n, t), Wi(e, t, n), n.memoizedState ? fl(n.memoizedState) : n.stateNode && (J || hl(n.stateNode));
					break;
				}
				case 27: if (xl) {
					J || si(n, t), M(n);
					var r = Ld, i = Rd;
					El(n.type) && (Ld = n.stateNode, Rd = !1), Wi(e, t, n), wl(n.stateNode, n.type, n.memoizedProps), Ld = r, Rd = i;
					break;
				}
				case 5: J || si(n, t), M(n);
				case 6:
					if (n.tag === 6 && M(n), V) {
						if (r = Ld, i = Rd, Ld = null, Wi(e, t, n), Ld = r, Rd = i, Ld !== null) {
							if (Rd) try {
								H(Ld, n.stateNode), Cd = !0;
							} catch (e) {
								P(n, t, e);
							}
							else try {
								Ys(Ld, n.stateNode), Cd = !0;
							} catch (e) {
								P(n, t, e);
							}
						}
					} else Wi(e, t, n);
					break;
				case 18:
					V && Ld !== null && (Rd ? tl(Ld, n.stateNode) : el(Ld, n.stateNode));
					break;
				case 4:
					V ? (r = Ld, i = Rd, Ld = n.stateNode.containerInfo, Rd = !0, Wi(e, t, n), Ld = r, Rd = i) : (ds && bi(n.stateNode, n, yc()), Wi(e, t, n));
					break;
				case 0:
				case 11:
				case 14:
				case 15:
					ri(2, n, t), J || ri(4, n, t), Wi(e, t, n);
					break;
				case 1:
					J || (si(n, t), r = n.stateNode, typeof r.componentWillUnmount == "function" && ai(n, t, r)), Wi(e, t, n);
					break;
				case 21:
					Wi(e, t, n);
					break;
				case 22:
					J = (r = J) || n.memoizedState !== null, Wi(e, t, n), J = r;
					break;
				case 30:
					si(n, t), Wi(e, t, n);
					break;
				case 7:
					J || si(n, t), Wi(e, t, n);
					break;
				default: Wi(e, t, n);
			}
		}
		function Ki(e, t) {
			if (fs && t.memoizedState === null && (e = t.alternate, e !== null && (e = e.memoizedState, e !== null))) {
				e = e.dehydrated;
				try {
					Xc(e);
				} catch (e) {
					P(t, t.return, e);
				}
			}
		}
		function qi(e, t) {
			if (fs && t.memoizedState === null && (e = t.alternate, e !== null && (e = e.memoizedState, e !== null && (e = e.dehydrated, e !== null)))) try {
				Zc(e);
			} catch (e) {
				P(t, t.return, e);
			}
		}
		function Ji(e) {
			switch (e.tag) {
				case 31:
				case 13:
				case 19:
					var t = e.stateNode;
					return t === null && (t = e.stateNode = new jd()), t;
				case 22: return e = e.stateNode, t = e._retryCache, t === null && (t = e._retryCache = new jd()), t;
				default: throw Error(r(435, e.tag));
			}
		}
		function Yi(e, t) {
			var n = Ji(e);
			t.forEach(function(t) {
				if (!n.has(t)) {
					n.add(t);
					var r = so.bind(null, e, t);
					t.then(r, r);
				}
			});
		}
		function Xi(e, t, n) {
			var i = t.deletions;
			if (i !== null) for (var a = 0; a < i.length; a++) {
				var o = i[a], s = e, c = t;
				if (V) {
					var l = c;
					a: for (; l !== null;) {
						switch (l.tag) {
							case 27: if (xl) {
								if (El(l.type)) {
									Ld = l.stateNode, Rd = !1;
									break a;
								}
								break;
							}
							case 5:
								Ld = l.stateNode, Rd = !1;
								break a;
							case 3:
							case 4:
								Ld = l.stateNode.containerInfo, Rd = !0;
								break a;
						}
						l = l.return;
					}
					if (Ld === null) throw Error(r(160));
					Gi(s, c, o), Ld = null, Rd = !1;
				} else Gi(s, c, o);
				s = o.alternate, s !== null && (s.return = null), o.return = null;
			}
			if (t.subtreeFlags & 13886) for (t = t.child; t !== null;) Zi(t, e, n), t = t.sibling;
		}
		function Zi(e, t, n) {
			var i = e.alternate, a = e.flags;
			switch (e.tag) {
				case 0:
				case 11:
				case 14:
				case 15:
					if (a & 4 && (i = e.updateQueue, i = i === null ? null : i.events, i !== null)) for (var o = 0; o < i.length; o++) {
						var s = i[o];
						s.ref.impl = s.nextImpl;
					}
					Xi(t, e, n), Qi(e), a & 4 && (ri(3, e, e.return), ni(3, e), ri(5, e, e.return));
					break;
				case 1:
					Xi(t, e, n), Qi(e), a & 512 && (J || i === null || si(i, i.return)), a & 64 && Od && (e = e.updateQueue, e !== null && (t = e.callbacks, t !== null && (a = e.shared.hiddenCallbacks, e.shared.hiddenCallbacks = a === null ? t : a.concat(t))));
					break;
				case 26: if (sl) {
					o = zd, Xi(t, e, n), Qi(e), a & 512 && (J || i === null || si(i, i.return)), a & 4 && (n = i === null ? null : i.memoizedState, a = e.memoizedState, i === null ? a === null ? e.stateNode === null ? e.stateNode = Od ? gl(e.type, e.memoizedProps, t.containerInfo, e) : pl(o, e.type, e.memoizedProps, e) : Od || ml(o, e.type, e.stateNode) : e.stateNode = dl(o, a, e.memoizedProps) : n === a ? a === null && e.stateNode !== null && mi(e, e.memoizedProps, i.memoizedProps) : (n === null ? (t = i.stateNode, t === null || J || hl(t)) : fl(n), a === null ? Od || ml(o, e.type, e.stateNode) : dl(o, a, e.memoizedProps)));
					break;
				}
				case 27: if (xl) {
					Xi(t, e, n), Qi(e), a & 512 && (J || i === null || si(i, i.return)), i !== null && a & 4 && mi(e, e.memoizedProps, i.memoizedProps);
					break;
				}
				case 5:
					if (o = kd, kd = !1, Xi(t, e, n), kd = o, Qi(e), a & 512 && (J || i === null || si(i, i.return)), V) {
						if (e.flags & 32) {
							t = e.stateNode;
							try {
								U(t), Cd = !0;
							} catch (t) {
								P(e, e.return, t);
							}
						}
						a & 4 && e.stateNode != null && (t = e.memoizedProps, mi(e, t, i === null ? t : i.memoizedProps)), a & 1024 && (Ad = !0);
					} else ds && e.alternate !== null && (e.alternate.stateNode = e.stateNode);
					break;
				case 6:
					if (Xi(t, e, n), Qi(e), a & 4 && V) {
						if (e.stateNode === null) throw Error(r(162));
						t = e.memoizedProps, a = i === null ? t : i.memoizedProps, n = e.stateNode;
						try {
							Ws(n, a, t), Cd = !0;
						} catch (t) {
							P(e, e.return, t);
						}
					}
					break;
				case 3:
					if (Cd = !1, sl ? (_l(), o = zd, zd = ll(t.containerInfo), Xi(t, e, n), zd = o) : Xi(t, e, n), Qi(e), a & 4) {
						if (V && fs && i !== null && i.memoizedState.isDehydrated) try {
							Yc(t.containerInfo);
						} catch (t) {
							P(e, e.return, t);
						}
						if (ds) {
							a = t.containerInfo, t = t.pendingChildren;
							try {
								Sc(a, t), Cd = !0;
							} catch (t) {
								P(e, e.return, t);
							}
						}
					}
					Ad && (Ad = !1, $i(e)), Cd = !1;
					break;
				case 4:
					i = kd, kd = Od, o = ci(), sl ? (s = zd, zd = ll(e.stateNode.containerInfo), Xi(t, e, n), Qi(e), zd = s) : (Xi(t, e, n), Qi(e)), Cd && Pd && (Fd = !0), Cd = o, kd = i, a & 4 && ds && bi(e.stateNode, e, e.stateNode.pendingChildren);
					break;
				case 12:
					Xi(t, e, n), Qi(e);
					break;
				case 31:
					Xi(t, e, n), Qi(e), a & 4 && (t = e.updateQueue, t !== null && (e.updateQueue = null, Yi(e, t)));
					break;
				case 13:
					Xi(t, e, n), Qi(e), e.child.flags & 8192 && e.memoizedState !== null != (i !== null && i.memoizedState !== null) && (uf = Bl()), a & 4 && (t = e.updateQueue, t !== null && (e.updateQueue = null, Yi(e, t)));
					break;
				case 22:
					o = e.memoizedState !== null, s = i !== null && i.memoizedState !== null;
					var c = Od, l = J, u = kd;
					Od = c || o, kd = u || o, J = l || s, Xi(t, e, n), J = l, kd = u, Od = c, Qi(e), a & 8192 && (t = e.stateNode, t._visibility = o ? t._visibility & -2 : t._visibility | 1, !o || i === null || s || Od || J || (t = xl ? 2 : 0, n = s || J, i = Od, s = J, Od = o || Od, J = n, ra(e, t), Od = i, J = s), V && (o || !kd) && Bi(e, o)), a & 4 && (t = e.updateQueue, t !== null && (a = t.retryQueue, a !== null && (t.retryQueue = null, Yi(e, a))));
					break;
				case 19:
					Xi(t, e, n), Qi(e), a & 4 && (t = e.updateQueue, t !== null && (e.updateQueue = null, Yi(e, t)));
					break;
				case 30:
					a & 512 && (J || i === null || si(i, i.return)), a = ci(), o = Pd, s = (n & 335544064) === n, c = e.memoizedProps, Pd = s && le(c.default, c.update) !== "none", Xi(t, e, n), Qi(e), s && i !== null && Cd && (e.flags |= 4), Pd = o, Cd = a;
					break;
				case 21: break;
				case 7: a & 512 && (J || i === null || si(i, i.return)), i && i.stateNode !== null && hc(e, i.stateNode);
				default: Xi(t, e, n), Qi(e);
			}
		}
		function Qi(e) {
			var t = e.flags;
			if (t & 2) {
				try {
					for (var n, i = e.return; i !== null;) {
						if (hi(i)) {
							n = i;
							break;
						}
						i = i.return;
					}
					i = null;
					for (var a = e.return; a !== null;) {
						if (fi(a)) {
							var o = a.stateNode;
							i === null ? i = [o] : i.push(o);
						}
						if (di(a)) break;
						a = a.return;
					}
					var s = i;
					if (V) {
						if (n == null) throw Error(r(160));
						switch (n.tag) {
							case 27: if (xl) {
								var c = n.stateNode;
								vi(e, gi(e), c, s);
								break;
							}
							case 5:
								var l = n.stateNode;
								n.flags & 32 && (U(l), n.flags &= -33), vi(e, gi(e), l, s);
								break;
							case 3:
							case 4:
								var u = n.stateNode.containerInfo;
								_i(e, gi(e), u, s);
								break;
							default: throw Error(r(161));
						}
					} else yi(e, s);
				} catch (t) {
					P(e, e.return, t);
				}
				e.flags &= -3;
			}
			t & 4096 && (e.flags &= -4097);
		}
		function $i(e) {
			if (e.subtreeFlags & 1024) for (e = e.child; e !== null;) {
				var t = e;
				$i(t), t.tag === 5 && t.flags & 1024 && As(t.stateNode), e = e.sibling;
			}
		}
		function ea(e, t) {
			if (t.subtreeFlags & 9270) for (t = t.child; t !== null;) ta(t, e), t = t.sibling;
			else Ii(t, !1);
		}
		function ta(e, t) {
			var n = e.alternate;
			if (n === null) Oi(e, !1);
			else switch (e.tag) {
				case 3:
					if (Id = Nd = !1, Ci(), ea(t, e), !Nd && !Fd) {
						if (e = Ed, e !== null) for (var r = 0; r < e.length; r += 3) tc(e[r], e[r + 1], e[r + 2]);
						nc(t.containerInfo), Id = !0;
					}
					Ed = null;
					break;
				case 5:
					ea(t, e);
					break;
				case 4:
					r = Nd, Nd = !1, ea(t, e), Nd && (Fd = !0), Nd = r;
					break;
				case 22:
					e.memoizedState === null && (n.memoizedState === null ? ea(t, e) : Oi(e, !1));
					break;
				case 30:
					r = Nd;
					var i = Ci();
					Nd = !1, ea(t, e), Nd && (e.flags |= 4);
					var a = e.memoizedProps, o = e.stateNode;
					t = se(a, o), o = se(n.memoizedProps, o);
					var s = le(a.default, a.update);
					s === "none" ? n = !1 : (a = n.memoizedState, n.memoizedState = null, n = e.child, Dd = 0, n = Fi(e, n, t, o, s, a, !0), Dd !== (a === null ? 0 : a.length) && (e.flags |= 32)), e.flags & 4 && n ? (wa(e, e.memoizedProps.onUpdate), Ed = i) : i !== null && (i.push.apply(i, Ed), Ed = i), Nd = e.flags & 32 ? !0 : r;
					break;
				default: ea(t, e);
			}
		}
		function na(e, t) {
			if (t.subtreeFlags & 8772) for (t = t.child; t !== null;) zi(e, t.alternate, t), t = t.sibling;
		}
		function ra(e, t) {
			for (e = e.child; e !== null;) {
				var n = e, r = t;
				switch (n.tag) {
					case 0:
					case 11:
					case 14:
					case 15:
						ri(4, n, n.return), ra(n, r);
						break;
					case 1:
						si(n, n.return);
						var i = n.stateNode;
						typeof i.componentWillUnmount == "function" && ai(n, n.return, i), ra(n, r);
						break;
					case 27: xl && r & 2 && wl(n.stateNode, n.type, n.memoizedProps);
					case 5:
						si(n, n.return), n.tag !== 5 && n.tag !== 27 || M(n), ra(n, r);
						break;
					case 6:
						M(n);
						break;
					case 26:
						si(n, n.return), sl && (i = n.stateNode, n.memoizedState !== null || i === null || J || hl(i)), ra(n, r);
						break;
					case 22:
						n.memoizedState === null && ra(n, r);
						break;
					case 30:
						si(n, n.return), ra(n, r);
						break;
					case 7: si(n, n.return);
					default: ra(n, r);
				}
				e = e.sibling;
			}
		}
		function ia(e, t, n) {
			for (n = t.subtreeFlags & 8772 ? n : n & -2, t = t.child; t !== null;) {
				var r = t.alternate, i = e, a = t, o = a.flags, s = !!(n & 1);
				switch (a.tag) {
					case 0:
					case 11:
					case 15:
						ia(i, a, n), ni(4, a);
						break;
					case 1:
						if (ia(i, a, n), r = a, i = r.stateNode, typeof i.componentDidMount == "function") try {
							i.componentDidMount();
						} catch (e) {
							P(r, r.return, e);
						}
						if (r = a, i = r.updateQueue, i !== null) {
							var c = r.stateNode;
							try {
								var l = i.shared.hiddenCallbacks;
								if (l !== null) for (i.shared.hiddenCallbacks = null, i = 0; i < l.length; i++) Dt(l[i], c);
							} catch (e) {
								P(r, r.return, e);
							}
						}
						s && o & 64 && ii(a), oi(a, a.return);
						break;
					case 27: xl && n & 2 && xi(a);
					case 5:
						a.tag !== 5 && a.tag !== 27 || ui(a), ia(i, a, n), s && r === null && o & 4 && pi(a), oi(a, a.return);
						break;
					case 6:
						ui(a);
						break;
					case 26:
						sl && (c = a.stateNode, a.memoizedState !== null || c === null || Od || ml(ll(c.ownerDocument), a.type, c)), ia(i, a, n), s && r === null && o & 4 && pi(a), oi(a, a.return);
						break;
					case 12:
						ia(i, a, n);
						break;
					case 31:
						ia(i, a, n), s && o & 4 && Ki(i, a);
						break;
					case 13:
						ia(i, a, n), s && o & 4 && qi(i, a);
						break;
					case 22:
						a.memoizedState === null && ia(i, a, n), oi(a, a.return);
						break;
					case 30:
						ia(i, a, n), oi(a, a.return);
						break;
					case 7: oi(a, a.return);
					default: ia(i, a, n);
				}
				t = t.sibling;
			}
		}
		function aa(e, t) {
			var n = null;
			e !== null && e.memoizedState !== null && e.memoizedState.cachePool !== null && (n = e.memoizedState.cachePool.pool), e = null, t.memoizedState !== null && t.memoizedState.cachePool !== null && (e = t.memoizedState.cachePool.pool), e !== n && (e != null && e.refCount++, n != null && He(n));
		}
		function oa(e, t) {
			e = null, t.alternate !== null && (e = t.alternate.memoizedState.cache), t = t.memoizedState.cache, t !== e && (t.refCount++, e != null && He(e));
		}
		function sa(e, t, n, r) {
			var i = (n & 335544064) === n;
			if (t.subtreeFlags & (i ? 10262 : 10256)) for (t = t.child; t !== null;) ca(e, t, n, r), t = t.sibling;
			else i && Pi(t);
		}
		function ca(e, t, n, r) {
			var i = (n & 335544064) === n;
			i && t.alternate === null && t.return !== null && t.return.alternate !== null && Ni(t);
			var a = t.flags;
			switch (t.tag) {
				case 0:
				case 11:
				case 15:
					sa(e, t, n, r), a & 2048 && ni(9, t);
					break;
				case 1:
					sa(e, t, n, r);
					break;
				case 3:
					sa(e, t, n, r), i && V && Id && rc(e.containerInfo), a & 2048 && (e = null, t.alternate !== null && (e = t.alternate.memoizedState.cache), t = t.memoizedState.cache, t !== e && (t.refCount++, e != null && He(e)));
					break;
				case 12:
					if (a & 2048) {
						sa(e, t, n, r), e = t.stateNode;
						try {
							var o = t.memoizedProps, s = o.id, c = o.onPostCommit;
							typeof c == "function" && c(s, t.alternate === null ? "mount" : "update", e.passiveEffectDuration, -0);
						} catch (e) {
							P(t, t.return, e);
						}
					} else sa(e, t, n, r);
					break;
				case 31:
					sa(e, t, n, r);
					break;
				case 13:
					sa(e, t, n, r);
					break;
				case 23: break;
				case 22:
					o = t.stateNode, s = t.alternate, t.memoizedState === null ? (i && s !== null && s.memoizedState !== null && Ni(t), o._visibility & 2 ? sa(e, t, n, r) : (o._visibility |= 2, la(e, t, n, r, !!(t.subtreeFlags & 10256) || !1))) : (i && s !== null && s.memoizedState === null && Ni(s), o._visibility & 2 ? sa(e, t, n, r) : ua(e, t)), a & 2048 && aa(s, t);
					break;
				case 24:
					sa(e, t, n, r), a & 2048 && oa(t.alternate, t);
					break;
				case 30:
					i && (i = t.alternate, i !== null && (Ei(i.child, !0), Ei(t.child, !0))), sa(e, t, n, r);
					break;
				default: sa(e, t, n, r);
			}
		}
		function la(e, t, n, r, i) {
			for (i &&= !!(t.subtreeFlags & 10256) || !1, t = t.child; t !== null;) {
				var a = e, o = t, s = n, c = r, l = o.flags;
				switch (o.tag) {
					case 0:
					case 11:
					case 15:
						la(a, o, s, c, i), ni(8, o);
						break;
					case 23: break;
					case 22:
						var u = o.stateNode;
						o.memoizedState === null ? (u._visibility |= 2, la(a, o, s, c, i)) : u._visibility & 2 ? la(a, o, s, c, i) : ua(a, o), i && l & 2048 && aa(o.alternate, o);
						break;
					case 24:
						la(a, o, s, c, i), i && l & 2048 && oa(o.alternate, o);
						break;
					default: la(a, o, s, c, i);
				}
				t = t.sibling;
			}
		}
		function ua(e, t) {
			if (t.subtreeFlags & 10256) for (t = t.child; t !== null;) {
				var n = e, r = t, i = r.flags;
				switch (r.tag) {
					case 22:
						ua(n, r), i & 2048 && aa(r.alternate, r);
						break;
					case 24:
						ua(n, r), i & 2048 && oa(r.alternate, r);
						break;
					default: ua(n, r);
				}
				t = t.sibling;
			}
		}
		function da(e, t, n) {
			if (e.subtreeFlags & Bd) for (e = e.child; e !== null;) N(e, t, n), e = e.sibling;
		}
		function N(e, t, n) {
			switch (e.tag) {
				case 26:
					if (da(e, t, n), e.flags & Bd) {
						if (e.memoizedState !== null) bl(n, zd, e.memoizedState, e.memoizedProps);
						else {
							var r = e.stateNode, i = e.type;
							e = e.memoizedProps, ((t & 335544128) === t || Ss(i, e)) && Ts(n, r, i, e);
						}
					}
					break;
				case 5:
					da(e, t, n), e.flags & Bd && (r = e.stateNode, i = e.type, e = e.memoizedProps, ((t & 335544128) === t || Ss(i, e)) && Ts(n, r, i, e));
					break;
				case 3:
				case 4:
					sl ? (r = zd, zd = ll(e.stateNode.containerInfo), da(e, t, n), zd = r) : da(e, t, n);
					break;
				case 22:
					e.memoizedState === null && (r = e.alternate, r !== null && r.memoizedState !== null ? (r = Bd, Bd = 16777216, da(e, t, n), Bd = r) : da(e, t, n));
					break;
				case 30:
					(e.flags & Bd) !== 0 && (r = e.memoizedProps.name, r != null && r !== "auto" && (i = e.stateNode, i.paired = null, Td === null && (Td = /* @__PURE__ */ new Map()), Td.set(r, i))), da(e, t, n);
					break;
				default: da(e, t, n);
			}
		}
		function fa(e) {
			var t = e.alternate;
			if (t !== null && (e = t.child, e !== null)) {
				t.child = null;
				do
					t = e.sibling, e.sibling = null, e = t;
				while (e !== null);
			}
		}
		function pa(e) {
			var t = e.deletions;
			if (e.flags & 16) {
				if (t !== null) for (var n = 0; n < t.length; n++) {
					var r = t[n];
					Md = r, ga(r, e);
				}
				fa(e);
			}
			if (e.subtreeFlags & 10256) for (e = e.child; e !== null;) ma(e), e = e.sibling;
		}
		function ma(e) {
			switch (e.tag) {
				case 0:
				case 11:
				case 15:
					pa(e), e.flags & 2048 && ri(9, e, e.return);
					break;
				case 3:
					pa(e);
					break;
				case 12:
					pa(e);
					break;
				case 22:
					var t = e.stateNode;
					e.memoizedState !== null && t._visibility & 2 && (e.return === null || e.return.tag !== 13) ? (t._visibility &= -3, ha(e)) : pa(e);
					break;
				default: pa(e);
			}
		}
		function ha(e) {
			var t = e.deletions;
			if (e.flags & 16) {
				if (t !== null) for (var n = 0; n < t.length; n++) {
					var r = t[n];
					Md = r, ga(r, e);
				}
				fa(e);
			}
			for (e = e.child; e !== null;) {
				switch (t = e, t.tag) {
					case 0:
					case 11:
					case 15:
						ri(8, t, t.return), ha(t);
						break;
					case 22:
						n = t.stateNode, n._visibility & 2 && (n._visibility &= -3, ha(t));
						break;
					default: ha(t);
				}
				e = e.sibling;
			}
		}
		function ga(e, t) {
			for (; Md !== null;) {
				var n = Md;
				switch (n.tag) {
					case 0:
					case 11:
					case 15:
						ri(8, n, t);
						break;
					case 23:
					case 22:
						if (n.memoizedState !== null && n.memoizedState.cachePool !== null) {
							var r = n.memoizedState.cachePool.pool;
							r != null && r.refCount++;
						}
						break;
					case 24: He(n.memoizedState.cache);
				}
				if (r = n.child, r !== null) r.return = n, Md = r;
				else a: for (n = e; Md !== null;) {
					r = Md;
					var i = r.sibling, a = r.return;
					if (Ui(r), r === n) {
						Md = null;
						break a;
					}
					if (i !== null) {
						i.return = a, Md = i;
						break a;
					}
					Md = a;
				}
			}
		}
		function _a(e) {
			var t = ps(e);
			if (t != null) {
				if (typeof t.memoizedProps["data-testname"] != "string") throw Error(r(364));
				return t;
			}
			if (e = Ps(e), e === null) throw Error(r(362));
			return e.stateNode.current;
		}
		function va(e, t) {
			var n = e.tag;
			switch (t.$$typeof) {
				case Hd:
					if (e.type === t.value) return !0;
					break;
				case Ud:
					a: {
						for (t = t.value, e = [e, 0], n = 0; n < e.length;) {
							var i = e[n++], a = i.tag, o = e[n++], s = t[o];
							if (a !== 5 && a !== 26 && a !== 27 || !Ls(i)) {
								for (; s != null && va(i, s);) o++, s = t[o];
								if (o === t.length) {
									t = !0;
									break a;
								}
								for (i = i.child; i !== null;) e.push(i, o), i = i.sibling;
							}
						}
						t = !1;
					}
					return t;
				case Wd:
					if ((n === 5 || n === 26 || n === 27) && Rs(e.stateNode, t.value)) return !0;
					break;
				case Kd:
					if ((n === 5 || n === 6 || n === 26 || n === 27) && (e = Is(e), e !== null && 0 <= e.indexOf(t.value))) return !0;
					break;
				case Gd:
					if ((n === 5 || n === 26 || n === 27) && (e = e.memoizedProps["data-testname"], typeof e == "string" && e.toLowerCase() === t.value.toLowerCase())) return !0;
					break;
				default: throw Error(r(365));
			}
			return !1;
		}
		function ya(e) {
			switch (e.$$typeof) {
				case Hd: return "<" + (d(e.value) || "Unknown") + ">";
				case Ud: return ":has(" + (ya(e) || "") + ")";
				case Wd: return "[role=\"" + e.value + "\"]";
				case Kd: return "\"" + e.value + "\"";
				case Gd: return "[data-testname=\"" + e.value + "\"]";
				default: throw Error(r(365));
			}
		}
		function ba(e, t) {
			var n = [];
			e = [e, 0];
			for (var r = 0; r < e.length;) {
				var i = e[r++], a = i.tag, o = e[r++], s = t[o];
				if (a !== 5 && a !== 26 && a !== 27 || !Ls(i)) {
					for (; s != null && va(i, s);) o++, s = t[o];
					if (o === t.length) n.push(i);
					else for (i = i.child; i !== null;) e.push(i, o), i = i.sibling;
				}
			}
			return n;
		}
		function xa(e, t) {
			if (!Ns) throw Error(r(363));
			e = _a(e), e = ba(e, t), t = [], e = Array.from(e);
			for (var n = 0; n < e.length;) {
				var i = e[n++], a = i.tag;
				if (a === 5 || a === 26 || a === 27) Ls(i) || t.push(i.stateNode);
				else for (i = i.child; i !== null;) e.push(i), i = i.sibling;
			}
			return t;
		}
		function Sa() {
			return Y & 2 && Q !== 0 ? Q & -Q : B.T === null ? _s() : O();
		}
		function Ca() {
			if (af === 0) {
				if (!(Q & 536870912) || G) {
					var e = Pl;
					Pl <<= 1, !(Pl & 3932160) && (Pl = 262144), af = e;
				} else af = 536870912;
			}
			return e = rd.current, e !== null && (e.flags |= 32), af;
		}
		function wa(e, t) {
			if (t != null) {
				var n = e.stateNode, r = n.ref;
				r === null && (r = n.ref = fc(se(e.memoizedProps, n))), Cf === null && (Cf = []), Cf.push(t.bind(null, r));
			}
		}
		function Ta(e, t, n) {
			(e === X && ($ === 2 || $ === 9) || e.cancelPendingCommit !== null) && (Ma(e, 0), ka(e, Q, af, !1)), x(e, n), (!(Y & 2) || e !== X) && (e === X && (!(Y & 2) && (nf |= n), ef === 4 && ka(e, Q, af, !1)), Ke(e));
		}
		function Ea(e, t, n) {
			if (Y & 6) throw Error(r(327));
			var i = !n && !(t & 127) && (t & e.expiredLanes) === 0 || v(e, t), a = i ? Ba(e, t) : Ra(e, t, !0), o = i;
			do {
				if (a === 0) {
					Zd && !i && ka(e, t, 0, !1);
					break;
				}
				if (n = e.current.alternate, o && !Oa(n)) {
					a = Ra(e, t, !1), o = !1;
					continue;
				}
				if (a === 2) {
					if (o = t, e.errorRecoveryDisabledLanes & o) var s = 0;
					else s = e.pendingLanes & -536870913, s = s === 0 ? s & 536870912 ? 536870912 : 0 : s;
					if (s !== 0) {
						t = s;
						a: {
							var c = e;
							a = sf;
							var l = fs && c.current.memoizedState.isDehydrated;
							if (l && (Ma(c, s).flags |= 256), s = Ra(c, s, !1), s !== 2 && s !== 6) {
								if (Qd && !l) {
									c.errorRecoveryDisabledLanes |= o, nf |= o, a = 4;
									break a;
								}
								o = cf, cf = a, o !== null && (cf === null ? cf = o : cf.push.apply(cf, o));
							}
							a = s;
						}
						if (o = !1, a !== 2) continue;
					}
				}
				if (a === 1) {
					Ma(e, 0), ka(e, t, 0, !0);
					break;
				}
				a: {
					switch (i = e, o = a, o) {
						case 0:
						case 1: throw Error(r(345));
						case 4: if ((t & 4194048) !== t && (t & 62914560) !== t) break;
						case 6:
							ka(i, t, af, !Xd);
							break a;
						case 2:
							cf = null;
							break;
						case 3:
						case 5: break;
						default: throw Error(r(329));
					}
					if ((t & 62914560) === t && (a = uf + 300 - Bl(), 10 < a)) {
						if (ka(i, t, af, !Xd), _(i, 0, !0) !== 0) break a;
						vf = t, i.timeoutHandle = ss(Da.bind(null, i, n, cf, pf, lf, t, af, nf, of, Xd, o, "Throttled", -0, 0), a);
						break a;
					}
					Da(i, n, cf, pf, lf, t, af, nf, of, Xd, o, null, -0, 0);
				}
				break;
			} while (1);
			Ke(e);
		}
		function Da(e, t, n, r, i, a, o, s, c, l, u, d, f, p) {
			e.timeoutHandle = ls;
			var m = t.subtreeFlags, h = (a & 335544064) === a;
			if (d = null, (h || m & 8192 || (m & 16785408) == 16785408) && (d = ws(), Td = null, N(t, a, d), h && Es(d, e.containerInfo), m = (a & 62914560) === a ? uf - Bl() : (a & 4194048) === a ? df - Bl() : 0, m = Ds(d, m), m !== null)) {
				vf = a, e.cancelPendingCommit = m(qa.bind(null, e, t, a, n, r, i, o, s, c, l, u, d, null, f, p)), ka(e, a, o, !l);
				return;
			}
			qa(e, t, a, n, r, i, o, s, c, l, u, d);
		}
		function Oa(e) {
			for (var t = e;;) {
				var n = t.tag;
				if ((n === 0 || n === 11 || n === 15) && t.flags & 16384 && (n = t.updateQueue, n !== null && (n = n.stores, n !== null))) for (var r = 0; r < n.length; r++) {
					var i = n[r], a = i.getSnapshot;
					i = i.value;
					try {
						if (!Xl(a(), i)) return !1;
					} catch {
						return !1;
					}
				}
				if (n = t.child, t.subtreeFlags & 16384 && n !== null) n.return = t, t = n;
				else {
					if (t === e) break;
					for (; t.sibling === null;) {
						if (t.return === null || t.return === e) return !0;
						t = t.return;
					}
					t.sibling.return = t.return, t = t.sibling;
				}
			}
			return !0;
		}
		function ka(e, t, n, r) {
			t = y(e, t), t &= ~rf, t &= ~nf, e.suspendedLanes |= t, e.pingedLanes &= ~t, r && (e.warmLanes |= t), r = e.expirationTimes;
			for (var i = t; 0 < i;) {
				var a = 31 - Al(i), o = 1 << a;
				r[a] = -1, i &= ~o;
			}
			n !== 0 && S(e, n, t);
		}
		function Aa() {
			return Y & 6 ? !0 : (qe(0, !1), !1);
		}
		function ja() {
			if (Z !== null) {
				if ($ === 0) var e = Z.return;
				else e = Z, Cu = Su = null, Jt(e), Ku = null, qu = 0, e = Z;
				for (; e !== null;) ti(e.alternate, e), e = e.return;
				Z = null;
			}
		}
		function Ma(e, t) {
			var n = e.timeoutHandle;
			return n !== ls && (e.timeoutHandle = ls, cs(n)), n = e.cancelPendingCommit, n !== null && (e.cancelPendingCommit = null, n()), vf = 0, ja(), X = e, Z = n = uo(e.current, null), Q = t, $ = 0, Yd = null, Xd = !1, Zd = v(e, t), Qd = !1, of = af = rf = nf = tf = ef = 0, cf = sf = null, lf = !1, $d = y(e, t), pt(), n;
		}
		function Na(e, t) {
			K = null, B.H = hd, t === Vu || t === Uu ? (t = st(), $ = 3) : t === Hu ? (t = st(), $ = 4) : $ = t === bd ? 8 : typeof t == "object" && t && typeof t.then == "function" ? 6 : 1, Yd = t, Z === null && (ef = 1, ir(e, me(t, e.current)));
		}
		function Pa() {
			var e = rd.current;
			return e === null ? !0 : (Q & 4194048) === Q ? id === null : (Q & 62914560) === Q || Q & 536870912 ? e === id : !1;
		}
		function Fa() {
			var e = B.H;
			return B.H = hd, e === null ? hd : e;
		}
		function Ia() {
			var e = B.A;
			return B.A = Vd, e;
		}
		function La() {
			ef = 4, Xd || (Q & 4194048) !== Q && rd.current !== null || (Zd = !0), !(tf & 134217727) && !(nf & 134217727) || X === null || ka(X, Q, af, !1);
		}
		function Ra(e, t, n) {
			var r = Y;
			Y |= 2;
			var i = Fa(), a = Ia();
			(X !== e || Q !== t) && (pf = null, Ma(e, t)), t = !1;
			var o = ef;
			a: do
				try {
					if ($ !== 0 && Z !== null) {
						var s = Z, c = Yd;
						switch ($) {
							case 8:
								ja(), o = 6;
								break a;
							case 3:
							case 2:
							case 9:
							case 6:
								rd.current === null && (t = !0);
								var l = $;
								if ($ = 0, Yd = null, Wa(e, s, c, l), n && Zd) {
									o = 0;
									break a;
								}
								break;
							default: l = $, $ = 0, Yd = null, Wa(e, s, c, l);
						}
					}
					za(), o = ef;
					break;
				} catch (t) {
					Na(e, t);
				}
			while (1);
			return t && e.shellSuspendCounter++, Cu = Su = null, Y = r, B.H = i, B.A = a, Z === null && (X = null, Q = 0, pt()), o;
		}
		function za() {
			for (; Z !== null;) Ha(Z);
		}
		function Ba(e, t) {
			var n = Y;
			Y |= 2;
			var i = Fa(), a = Ia();
			X !== e || Q !== t ? (pf = null, ff = Bl() + 500, Ma(e, t)) : Zd = v(e, t);
			a: do
				try {
					if ($ !== 0 && Z !== null) {
						t = Z;
						var o = Yd;
						b: switch ($) {
							case 1:
								$ = 0, Yd = null, Wa(e, t, o, 1);
								break;
							case 2:
							case 9:
								if (it(o)) {
									$ = 0, Yd = null, Ua(t);
									break;
								}
								t = function() {
									$ !== 2 && $ !== 9 || X !== e || ($ = 7), Ke(e);
								}, o.then(t, t);
								break a;
							case 3:
								$ = 7;
								break a;
							case 4:
								$ = 5;
								break a;
							case 7:
								it(o) ? ($ = 0, Yd = null, Ua(t)) : ($ = 0, Yd = null, Wa(e, t, o, 7));
								break;
							case 5:
								var s = null;
								switch (Z.tag) {
									case 26: s = Z.memoizedState;
									case 5:
									case 27:
										var c = Z, l = c.type, u = c.pendingProps;
										if (s ? yl(s) : Cs(c.stateNode, l, u)) {
											$ = 0, Yd = null;
											var d = c.sibling;
											if (d !== null) Z = d;
											else {
												var f = c.return;
												f === null ? Z = null : (Z = f, Ga(f));
											}
											break b;
										}
								}
								$ = 0, Yd = null, Wa(e, t, o, 5);
								break;
							case 6:
								$ = 0, Yd = null, Wa(e, t, o, 6);
								break;
							case 8:
								ja(), ef = 6;
								break a;
							default: throw Error(r(462));
						}
					}
					Va();
					break;
				} catch (t) {
					Na(e, t);
				}
			while (1);
			return Cu = Su = null, B.H = i, B.A = a, Y = n, Z === null ? (X = null, Q = 0, pt(), ef) : 0;
		}
		function Va() {
			for (; Z !== null && !Rl();) Ha(Z);
		}
		function Ha(e) {
			var t = Vr(e.alternate, e, $d);
			e.memoizedProps = e.pendingProps, t === null ? Ga(e) : Z = t;
		}
		function Ua(e) {
			var t = e, n = t.alternate;
			switch (t.tag) {
				case 15:
				case 0:
					t = Sr(n, t, t.pendingProps, t.type, void 0, Q);
					break;
				case 11:
					t = Sr(n, t, t.pendingProps, t.type.render, t.ref, Q);
					break;
				case 5:
					Jt(t);
					var r = t;
					fs && r === gu && (G ? (Ee(r), r.tag === 5 && r.stateNode != null && (_u = r.stateNode)) : (Ee(r), G = !0));
				default: ti(n, t), t = Z = fo(t, $d), t = Vr(n, t, $d);
			}
			e.memoizedProps = e.pendingProps, t === null ? Ga(e) : Z = t;
		}
		function Wa(e, t, n, r) {
			Cu = Su = null, Jt(t), Ku = null, qu = 0;
			var i = t.return;
			try {
				if (lr(e, i, t, n, Q)) {
					ef = 1, ir(e, me(n, e.current)), Z = null;
					return;
				}
			} catch (t) {
				if (i !== null) throw Z = i, t;
				ef = 1, ir(e, me(n, e.current)), Z = null;
				return;
			}
			t.flags & 32768 ? (G || r === 1 ? e = !0 : Zd || Q & 536870912 ? e = !1 : (Xd = e = !0, (r === 2 || r === 9 || r === 3 || r === 6) && (r = rd.current, r !== null && r.tag === 13 && (r.flags |= 16384))), Ka(t, e)) : Ga(t);
		}
		function Ga(e) {
			var t = e;
			do {
				if (t.flags & 32768) {
					Ka(t, Xd);
					return;
				}
				e = t.return;
				var n = $r(t.alternate, t, $d);
				if (n !== null) {
					Z = n;
					return;
				}
				if (t = t.sibling, t !== null) {
					Z = t;
					return;
				}
				Z = t = e;
			} while (t !== null);
			ef === 0 && (ef = 5);
		}
		function Ka(e, t) {
			do {
				var n = ei(e.alternate, e);
				if (n !== null) {
					n.flags &= 32767, Z = n;
					return;
				}
				if (n = e.return, n !== null && (n.flags |= 32768, n.subtreeFlags = 0, n.deletions = null), !t && (e = e.sibling, e !== null)) {
					Z = e;
					return;
				}
				Z = e = n;
			} while (e !== null);
			ef = 6, Z = null;
		}
		function qa(e, t, n, i, a, o, s, c, l, u, d, f) {
			e.cancelPendingCommit = null;
			do
				to();
			while (hf !== 0);
			if (Y & 6) throw Error(r(327));
			if (t !== null) {
				if (t === e.current) throw Error(r(177));
				e === X && (Z = X = null, Q = 0), _f = t, gf = e, vf = n, bf = a, xf = i, Ja(e, t, n, s, c, l, f);
			}
		}
		function Ja(e, t, n, r, i, a, o) {
			var s = t.lanes | t.childLanes;
			if (yf = s, s |= Qu, ne(e, n, s, r, i, a), Cf = null, (n & 335544064) === n ? (wf = We(e), r = 10262) : (wf = null, r = 10256), (t.subtreeFlags & r) !== 0 || (t.flags & r) !== 0 ? (e.callbackNode = null, e.callbackPriority = 0, I(Ul, function() {
				return no(), null;
			})) : (e.callbackNode = null, e.callbackPriority = 0), wd = !1, r = !!(t.flags & 13878), t.subtreeFlags & 13878 || r) {
				r = B.T, B.T = null, i = gs(), hs(2), a = Y, Y |= 4;
				try {
					Li(e, t, n);
				} finally {
					Y = a, hs(i), B.T = r;
				}
			}
			hf = 1, wd ? Sf = lc(o, e.containerInfo, wf, Za, Qa, Xa, $a, no, Ya, null, null) : (Za(), Qa(), $a());
		}
		function Ya(e) {
			if (hf !== 0) {
				var t = gf.onRecoverableError;
				t(e, { componentStack: null });
			}
		}
		function Xa() {
			hf === 3 && (hf = 0, ta(_f, gf), hf = 4);
		}
		function Za() {
			if (hf === 1) {
				hf = 0;
				var e = gf, t = _f, n = vf, r = !!(t.flags & 13878);
				if (t.subtreeFlags & 13878 || r) {
					r = B.T, B.T = null;
					var i = gs();
					hs(2);
					var a = Y;
					Y |= 4;
					try {
						Pd = Fd = !1, Zi(t, e, n), ts(e.containerInfo);
					} finally {
						Y = a, hs(i), B.T = r;
					}
				}
				e.current = t, hf = 2;
			}
		}
		function Qa() {
			if (hf === 2) {
				hf = 0;
				var e = gf, t = _f, n = !!(t.flags & 8772);
				if (t.subtreeFlags & 8772 || n) {
					n = B.T, B.T = null;
					var r = gs();
					hs(2);
					var i = Y;
					Y |= 4;
					try {
						zi(e, t.alternate, t);
					} finally {
						Y = i, hs(r), B.T = n;
					}
				}
				hf = 3;
			}
		}
		function $a() {
			if (hf === 4 || hf === 3) {
				hf = 0;
				var e = Sf;
				Sf = null, zl();
				var t = gf, n = _f, r = vf, i = xf, a = (r & 335544064) === r ? 10262 : 10256;
				if ((n.subtreeFlags & a) !== 0 || (n.flags & a) !== 0 ? hf = 5 : (hf = 0, _f = gf = null, eo(t, t.pendingLanes)), a = t.pendingLanes, a === 0 && (mf = null), ae(r), n = n.stateNode, Jl && typeof Jl.onCommitFiberRoot == "function") try {
					Jl.onCommitFiberRoot(ql, n, void 0, (n.current.flags & 128) == 128);
				} catch {}
				if (i !== null) {
					n = B.T, a = gs(), hs(2), B.T = null;
					try {
						for (var o = t.onRecoverableError, s = 0; s < i.length; s++) {
							var c = i[s];
							o(c.value, { componentStack: c.stack });
						}
					} finally {
						B.T = n, hs(a);
					}
				}
				if (i = Cf, o = wf, wf = null, i !== null && (Cf = null, o === null && (o = []), e !== null)) for (c = 0; c < i.length; c++) n = (0, i[c])(o), n !== void 0 && dc(e, n);
				vf & 3 && to(), Ke(t), a = t.pendingLanes, r & 261930 && a & 42 ? t === Ef ? Tf++ : (Tf = 0, Ef = t) : (Tf = 0, Ef = null), fs && $c(), qe(0, !1);
			}
		}
		function eo(e, t) {
			(e.pooledCacheLanes &= t) === 0 && (t = e.pooledCache, t != null && (e.pooledCache = null, He(t)));
		}
		function to() {
			return Sf !== null && (uc(Sf), Sf = null), Za(), Qa(), $a(), no();
		}
		function no() {
			if (hf !== 5) return !1;
			var e = gf, t = yf;
			yf = 0;
			var n = ae(vf), i = 32 > n ? 32 : n;
			n = B.T;
			var a = gs();
			try {
				hs(i), B.T = null, i = bf, bf = null;
				var o = gf, s = vf;
				if (hf = 0, _f = gf = null, vf = 0, Y & 6) throw Error(r(331));
				var c = Y;
				if (Y |= 4, ma(o.current), ca(o, o.current, s, i), Y = c, qe(0, !1), Jl && typeof Jl.onPostCommitFiberRoot == "function") try {
					Jl.onPostCommitFiberRoot(ql, o);
				} catch {}
				return !0;
			} finally {
				hs(a), B.T = n, eo(e, t);
			}
		}
		function ro(e, t, n) {
			t = me(n, t), t = or(e.stateNode, t, 2), e = St(e, t, 2), e !== null && (x(e, 2), Ke(e));
		}
		function P(e, t, n) {
			if (e.tag === 3) ro(e, e, n);
			else for (; t !== null;) {
				if (t.tag === 3) {
					ro(t, e, n);
					break;
				}
				if (t.tag === 1) {
					var r = t.stateNode;
					if (typeof t.type.getDerivedStateFromError == "function" || typeof r.componentDidCatch == "function" && (mf === null || !mf.has(r))) {
						e = me(n, e), n = sr(2), r = St(t, n, 2), r !== null && (cr(n, r, t, e), x(r, 2), Ke(r));
						break;
					}
				}
				t = t.return;
			}
		}
		function F(e, t, n) {
			var r = e.pingCache;
			if (r === null) {
				r = e.pingCache = new Jd();
				var i = /* @__PURE__ */ new Set();
				r.set(t, i);
			} else i = r.get(t), i === void 0 && (i = /* @__PURE__ */ new Set(), r.set(t, i));
			i.has(n) || (Qd = !0, i.add(n), e = io.bind(null, e, t, n), t.then(e, e));
		}
		function io(e, t, n) {
			var r = e.pingCache;
			r !== null && r.delete(t), e.pingedLanes |= e.suspendedLanes & n, e.warmLanes &= ~n, X === e && (Q & n) === n && (ef === 4 || ef === 3 && (Q & 62914560) === Q && 300 > Bl() - uf ? Y & 2 ? rf |= n : Ma(e, 0) : rf |= n, of === Q && (of = 0)), Ke(e);
		}
		function ao(e, t) {
			t === 0 && (t = te()), e = gt(e, t), e !== null && (x(e, t), Ke(e));
		}
		function oo(e) {
			var t = e.memoizedState, n = 0;
			t !== null && (n = t.retryLane), ao(e, n);
		}
		function so(e, t) {
			var n = 0;
			switch (e.tag) {
				case 31:
				case 13:
					var i = e.stateNode, a = e.memoizedState;
					a !== null && (n = a.retryLane);
					break;
				case 19:
					i = e.stateNode;
					break;
				case 22:
					i = e.stateNode._retryCache;
					break;
				default: throw Error(r(314));
			}
			i !== null && i.delete(t), ao(e, n);
		}
		function I(e, t) {
			return Il(e, t);
		}
		function co(e, t, n, r) {
			this.tag = e, this.key = n, this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null, this.index = 0, this.refCleanup = this.ref = null, this.pendingProps = t, this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null, this.mode = r, this.subtreeFlags = this.flags = 0, this.deletions = null, this.childLanes = this.lanes = 0, this.alternate = null;
		}
		function lo(e) {
			return e = e.prototype, !(!e || !e.isReactComponent);
		}
		function uo(e, n) {
			var r = e.alternate;
			return r === null ? (r = t(e.tag, n, e.key, e.mode), r.elementType = e.elementType, r.type = e.type, r.stateNode = e.stateNode, r.alternate = e, e.alternate = r) : (r.pendingProps = n, r.type = e.type, r.flags = 0, r.subtreeFlags = 0, r.deletions = null), r.flags = e.flags & 1206910976, r.childLanes = e.childLanes, r.lanes = e.lanes, r.child = e.child, r.memoizedProps = e.memoizedProps, r.memoizedState = e.memoizedState, r.updateQueue = e.updateQueue, n = e.dependencies, r.dependencies = n === null ? null : {
				lanes: n.lanes,
				firstContext: n.firstContext
			}, r.sibling = e.sibling, r.index = e.index, r.ref = e.ref, r.refCleanup = e.refCleanup, r;
		}
		function fo(e, t) {
			e.flags &= 1206910978;
			var n = e.alternate;
			return n === null ? (e.childLanes = 0, e.lanes = t, e.child = null, e.subtreeFlags = 0, e.memoizedProps = null, e.memoizedState = null, e.updateQueue = null, e.dependencies = null, e.stateNode = null) : (e.childLanes = n.childLanes, e.lanes = n.lanes, e.child = n.child, e.subtreeFlags = 0, e.deletions = null, e.memoizedProps = n.memoizedProps, e.memoizedState = n.memoizedState, e.updateQueue = n.updateQueue, e.type = n.type, t = n.dependencies, e.dependencies = t === null ? null : {
				lanes: t.lanes,
				firstContext: t.firstContext
			}), e;
		}
		function L(e, n, i, a, o, s) {
			var c = 0;
			if (a = e, typeof a == "function") lo(a) && (c = 1);
			else if (typeof a == "string") c = sl && xl ? cl(e, i, fu.current) ? 26 : Tl(e) ? 27 : 5 : sl ? cl(e, i, fu.current) ? 26 : 5 : xl && Tl(e) ? 27 : 5;
			else a: switch (a) {
				case zo: return e = t(31, i, n, o), e.elementType = zo, e.lanes = s, e;
				case ko: return po(i.children, o, s, n);
				case Ao:
					c = 8, o |= 24;
					break;
				case jo: return e = t(12, i, n, o | 2), e.elementType = jo, e.lanes = s, e;
				case Fo: return e = t(13, i, n, o), e.elementType = Fo, e.lanes = s, e;
				case Io: return e = t(19, i, n, o), e.elementType = Io, e.lanes = s, e;
				case Bo:
				case Ho: return e = o | 32, e = t(30, i, n, e), e.elementType = Ho, e.lanes = s, e.stateNode = {
					autoName: null,
					paired: null,
					clones: null,
					ref: null
				}, e;
				default:
					if (typeof a == "object" && a) switch (a.$$typeof) {
						case No:
							c = 10;
							break a;
						case Mo:
							c = 9;
							break a;
						case Po:
							c = 11;
							break a;
						case Lo:
							c = 14;
							break a;
						case Ro:
							c = 16, a = null;
							break a;
					}
					c = 29, i = Error(r(130, e === null ? "null" : typeof e, "")), a = null;
			}
			return n = t(c, i, n, o), n.elementType = e, n.type = a, n.lanes = s, n;
		}
		function po(e, n, r, i) {
			return e = t(7, e, i, n), e.lanes = r, e;
		}
		function mo(e, n, r) {
			return e = t(6, e, null, n), e.lanes = r, e;
		}
		function ho(e) {
			var n = t(18, null, null, 0);
			return n.stateNode = e, n;
		}
		function go(e, n, r) {
			return n = t(4, e.children === null ? [] : e.children, e.key, n), n.lanes = r, n.stateNode = {
				containerInfo: e.containerInfo,
				pendingChildren: null,
				implementation: e.implementation
			}, n;
		}
		function _o(e, t, n, r, i, a, o, s, c) {
			this.tag = 1, this.containerInfo = e, this.pingCache = this.current = this.pendingChildren = null, this.timeoutHandle = ls, this.callbackNode = this.next = this.pendingContext = this.context = this.cancelPendingCommit = null, this.callbackPriority = 0, this.expirationTimes = b(-1), this.entangledLanes = this.shellSuspendCounter = this.errorRecoveryDisabledLanes = this.expiredLanes = this.warmLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0, this.entanglements = b(0), this.hiddenUpdates = b(null), this.identifierPrefix = r, this.onUncaughtError = i, this.onCaughtError = a, this.onRecoverableError = o, this.pooledCache = null, this.pooledCacheLanes = 0, this.formState = c, this.transitionTypes = null, this.incompleteTransitions = /* @__PURE__ */ new Map();
		}
		function vo(e, n, r, i, a, o, s, c, l, u, d, f) {
			return e = new _o(e, n, r, s, l, u, d, f, c), n = 1, !0 === o && (n |= 24), o = t(3, null, null, n), e.current = o, o.stateNode = e, n = Ve(), n.refCount++, e.pooledCache = n, n.refCount++, o.memoizedState = {
				element: i,
				isDehydrated: r,
				cache: n
			}, yt(o), e;
		}
		function yo(e) {
			return e ? (e = kl, e) : kl;
		}
		function bo(e) {
			var t = e._reactInternals;
			if (t === void 0) throw typeof e.render == "function" ? Error(r(188)) : (e = Object.keys(e).join(","), Error(r(268, e)));
			return e = o(t), e = e === null ? null : s(e), e === null ? null : Zo(e.stateNode);
		}
		function xo(e, t, n, r, i, a) {
			i = yo(i), r.context === null ? r.context = i : r.pendingContext = i, r = xt(t), r.payload = { element: n }, a = a === void 0 ? null : a, a !== null && (r.callback = a), n = St(e, r, t), n !== null && (Ta(n, e, t), Ct(n, e, t));
		}
		function So(e, t) {
			if (e = e.memoizedState, e !== null && e.dehydrated !== null) {
				var n = e.retryLane;
				e.retryLane = n !== 0 && n < t ? n : t;
			}
		}
		function Co(e, t) {
			So(e, t), (e = e.alternate) && So(e, t);
		}
		var R = {}, wo = u(), z = Us(), To = Object.assign, Eo = Symbol.for("react.element"), Do = Symbol.for("react.transitional.element"), Oo = Symbol.for("react.portal"), ko = Symbol.for("react.fragment"), Ao = Symbol.for("react.strict_mode"), jo = Symbol.for("react.profiler"), Mo = Symbol.for("react.consumer"), No = Symbol.for("react.context"), Po = Symbol.for("react.forward_ref"), Fo = Symbol.for("react.suspense"), Io = Symbol.for("react.suspense_list"), Lo = Symbol.for("react.memo"), Ro = Symbol.for("react.lazy"), zo = Symbol.for("react.activity"), Bo = Symbol.for("react.legacy_hidden"), Vo = Symbol.for("react.memo_cache_sentinel"), Ho = Symbol.for("react.view_transition"), Uo = Symbol.for("react.recoverable"), Wo = Symbol.iterator, Go = Symbol.for("react.optimistic_key"), Ko = Symbol.for("react.client.reference"), qo = Array.isArray, B = wo.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, Jo = e.rendererVersion, Yo = e.rendererPackageName, Xo = e.extraDevToolsConfig, Zo = e.getPublicInstance, Qo = e.getRootHostContext, $o = e.getChildHostContext, es = e.prepareForCommit, ts = e.resetAfterCommit, ns = e.createInstance;
		e.cloneMutableInstance;
		var rs = e.appendInitialChild, is = e.finalizeInitialChildren, as = e.shouldSetTextContent, os = e.createTextInstance;
		e.cloneMutableTextInstance;
		var ss = e.scheduleTimeout, cs = e.cancelTimeout, ls = e.noTimeout, us = e.isPrimaryRenderer;
		e.warnsIfNotActing;
		var V = e.supportsMutation, ds = e.supportsPersistence, fs = e.supportsHydration, ps = e.getInstanceFromNode;
		e.beforeActiveInstanceBlur;
		var ms = e.preparePortalMount;
		e.prepareScopeUpdate, e.getInstanceFromScope;
		var hs = e.setCurrentUpdatePriority, gs = e.getCurrentUpdatePriority, _s = e.resolveUpdatePriority;
		e.trackSchedulerEvent, e.resolveEventType, e.resolveEventTimeStamp;
		var vs = e.shouldAttemptEagerTransition, ys = e.detachDeletedInstance;
		e.requestPostPaintCallback;
		var bs = e.maySuspendCommit, xs = e.maySuspendCommitOnUpdate, Ss = e.maySuspendCommitInSyncRender, Cs = e.preloadInstance, ws = e.startSuspendingCommit, Ts = e.suspendInstance, Es = e.suspendOnActiveViewTransition, Ds = e.waitForCommitToBeReady;
		e.getSuspendedCommitReason;
		var Os = e.NotPendingTransition, ks = e.HostTransitionContext, As = e.resetFormInstance;
		e.bindToConsole;
		var js = e.supportsMicrotasks, Ms = e.scheduleMicrotask, Ns = e.supportsTestSelectors, Ps = e.findFiberRoot, Fs = e.getBoundingRect, Is = e.getTextContent, Ls = e.isHiddenSubtree, Rs = e.matchAccessibilityRole, zs = e.setFocusIfFocusable, Bs = e.setupIntersectionObserver, Vs = e.appendChild, Hs = e.appendChildToContainer, Ws = e.commitTextUpdate, Gs = e.commitMount, Ks = e.commitUpdate, qs = e.insertBefore, Js = e.insertInContainerBefore, Ys = e.removeChild, H = e.removeChildFromContainer, U = e.resetTextContent, W = e.hideInstance, Xs = e.hideTextInstance, Zs = e.unhideInstance, Qs = e.unhideTextInstance, $s = e.applyViewTransitionName, ec = e.restoreViewTransitionName, tc = e.cancelViewTransitionName, nc = e.cancelRootViewTransitionName, rc = e.restoreRootViewTransitionName;
		e.cloneRootViewTransitionContainer, e.removeRootViewTransitionClone;
		var ic = e.measureInstance, ac = e.measureClonedInstance, oc = e.wasInstanceInViewport, sc = e.hasInstanceChanged, cc = e.hasInstanceAffectedParent, lc = e.startViewTransition;
		e.startGestureTransition;
		var uc = e.stopViewTransition, dc = e.addViewTransitionFinishedListener;
		e.getCurrentGestureOffset;
		var fc = e.createViewTransitionInstance, pc = e.clearContainer, mc = e.createFragmentInstance, hc = e.updateFragmentInstanceFiber, gc = e.commitNewChildToFragmentInstance, _c = e.deleteChildFromFragmentInstance, vc = e.cloneInstance, yc = e.createContainerChildSet, bc = e.appendChildToContainerChildSet, xc = e.finalizeContainerChildren, Sc = e.replaceContainerChildren, Cc = e.cloneHiddenInstance, wc = e.cloneHiddenTextInstance, Tc = e.isSuspenseInstancePending, Ec = e.isSuspenseInstanceFallback, Dc = e.getSuspenseInstanceFallbackErrorDetails, Oc = e.registerSuspenseInstanceRetry, kc = e.canHydrateFormStateMarker, Ac = e.isFormStateMarkerMatching, jc = e.getNextHydratableSibling, Mc = e.getNextHydratableSiblingAfterSingleton, Nc = e.getFirstHydratableChild, Pc = e.getFirstHydratableChildWithinContainer, Fc = e.getFirstHydratableChildWithinActivityInstance, Ic = e.getFirstHydratableChildWithinSuspenseInstance, Lc = e.getFirstHydratableChildWithinSingleton, Rc = e.canHydrateInstance, zc = e.canHydrateTextInstance, Bc = e.canHydrateActivityInstance, Vc = e.canHydrateSuspenseInstance, Hc = e.hydrateInstance, Uc = e.hydrateTextInstance, Wc = e.hydrateActivityInstance, Gc = e.hydrateSuspenseInstance, Kc = e.getNextHydratableInstanceAfterActivityInstance, qc = e.getNextHydratableInstanceAfterSuspenseInstance, Jc = e.commitHydratedInstance, Yc = e.commitHydratedContainer, Xc = e.commitHydratedActivityInstance, Zc = e.commitHydratedSuspenseInstance, Qc = e.finalizeHydratedChildren, $c = e.flushHydrationEvents;
		e.clearActivityBoundary;
		var el = e.clearSuspenseBoundary;
		e.clearActivityBoundaryFromContainer;
		var tl = e.clearSuspenseBoundaryFromContainer, nl = e.hideDehydratedBoundary, rl = e.unhideDehydratedBoundary, il = e.shouldDeleteUnhydratedTailInstances;
		e.diffHydratedPropsForDevWarnings, e.diffHydratedTextForDevWarnings, e.describeHydratableInstanceForDevWarnings;
		var al = e.validateHydratableInstance, ol = e.validateHydratableTextInstance, sl = e.supportsResources, cl = e.isHostHoistableType, ll = e.getHoistableRoot, ul = e.getResource, dl = e.acquireResource, fl = e.releaseResource, pl = e.hydrateHoistable, ml = e.mountHoistable, hl = e.unmountHoistable, gl = e.createHoistableInstance, _l = e.prepareToCommitHoistables, vl = e.mayResourceSuspendCommit, yl = e.preloadResource, bl = e.suspendResource, xl = e.supportsSingletons, Sl = e.resolveSingletonInstance, Cl = e.acquireSingletonInstance, wl = e.releaseSingletonInstance, Tl = e.isHostSingletonType, El = e.isSingletonScope, Dl = [], Ol = -1, kl = {}, Al = Math.clz32 ? Math.clz32 : h, jl = Math.log, Ml = Math.LN2, Nl = 256, Pl = 262144, Fl = 4194304, Il = z.unstable_scheduleCallback, Ll = z.unstable_cancelCallback, Rl = z.unstable_shouldYield, zl = z.unstable_requestPaint, Bl = z.unstable_now, Vl = z.unstable_ImmediatePriority, Hl = z.unstable_UserBlockingPriority, Ul = z.unstable_NormalPriority, Wl = z.unstable_IdlePriority, Gl = z.log, Kl = z.unstable_setDisableYieldValue, ql = null, Jl = null, Yl = 0, Xl = typeof Object.is == "function" ? Object.is : ue, Zl = typeof reportError == "function" ? reportError : function(e) {
			if (typeof window == "object" && typeof window.ErrorEvent == "function") {
				var t = new window.ErrorEvent("error", {
					bubbles: !0,
					cancelable: !0,
					message: typeof e == "object" && e && typeof e.message == "string" ? String(e.message) : String(e),
					error: e
				});
				if (!window.dispatchEvent(t)) return;
			} else if (typeof process == "object" && typeof process.emit == "function") {
				process.emit("uncaughtException", e);
				return;
			}
			console.error(e);
		}, Ql = Object.prototype.hasOwnProperty, $l, eu, tu = !1, nu = /* @__PURE__ */ new WeakMap(), ru = [], iu = 0, au = null, ou = 0, su = [], cu = 0, lu = null, uu = 1, du = "", fu = f(null), pu = f(null), mu = f(null), hu = f(null), gu = null, _u = null, G = !1, vu = null, yu = !1, bu = Error(r(519)), xu = f(null), Su = null, Cu = null, wu = typeof AbortController < "u" ? AbortController : function() {
			var e = [], t = this.signal = {
				aborted: !1,
				addEventListener: function(t, n) {
					e.push(n);
				}
			};
			this.abort = function() {
				t.aborted = !0, e.forEach(function(e) {
					return e();
				});
			};
		}, Tu = z.unstable_scheduleCallback, Eu = z.unstable_NormalPriority, Du = {
			$$typeof: No,
			Consumer: null,
			Provider: null,
			_currentValue: null,
			_currentValue2: null,
			_threadCount: 0
		}, Ou = null, ku = null, Au = null, ju = !1, Mu = !1, Nu = !1, Pu = 0, Fu = null, Iu = 0, Lu = 0, Ru = null, zu = B.S;
		B.S = function(e, t) {
			if (df = Bl(), typeof t == "object" && t && typeof t.then == "function" && Ze(e, t), Ou !== null) for (var n = ku; n !== null;) Ue(n, Ou), n = n.next;
			if (n = e.types, n !== null) {
				for (var r = ku; r !== null;) Ue(r, n), r = r.next;
				if (Lu !== 0) {
					r = Ou, r === null && (r = Ou = []);
					for (var i = 0; i < n.length; i++) {
						var a = n[i];
						r.indexOf(a) === -1 && r.push(a);
					}
				}
			}
			zu !== null && zu(e, t);
		};
		var Bu = f(null), Vu = Error(r(460)), Hu = Error(r(474)), Uu = Error(r(542)), Wu = { then: function() {} }, Gu = null, Ku = null, qu = 0, Ju = ft(!0), Yu = ft(!1), Xu = [], Zu = 0, Qu = 0, $u = !1, ed = !1, td = f(null), nd = f(0), rd = f(null), id = null, ad = f(0), od = 0, K = null, q = null, sd = null, cd = !1, ld = !1, ud = !1, dd = 0, fd = 0, pd = null, md = 0, hd = {
			readContext: Re,
			use: $t,
			useCallback: Bt,
			useContext: Bt,
			useEffect: Bt,
			useImperativeHandle: Bt,
			useLayoutEffect: Bt,
			useInsertionEffect: Bt,
			useMemo: Bt,
			useReducer: Bt,
			useRef: Bt,
			useState: Bt,
			useDebugValue: Bt,
			useDeferredValue: Bt,
			useTransition: Bt,
			useSyncExternalStore: Bt,
			useId: Bt,
			useHostTransitionStatus: Bt,
			useFormState: Bt,
			useActionState: Bt,
			useOptimistic: Bt,
			useMemoCache: Bt,
			useCacheRefresh: Bt,
			useEffectEvent: Bt
		}, gd = {
			readContext: Re,
			use: $t,
			useCallback: function(e, t) {
				return Yt().memoizedState = [e, t === void 0 ? null : t], e;
			},
			useContext: Re,
			useEffect: On,
			useImperativeHandle: function(e, t, n) {
				n = n == null ? null : n.concat([e]), En(4194308, 4, Pn.bind(null, t, e), n);
			},
			useLayoutEffect: function(e, t) {
				return En(4194308, 4, e, t);
			},
			useInsertionEffect: function(e, t) {
				En(4, 2, e, t);
			},
			useMemo: function(e, t) {
				var n = Yt();
				t = t === void 0 ? null : t;
				var r = e();
				if (ud) {
					oe(!0);
					try {
						e();
					} finally {
						oe(!1);
					}
				}
				return n.memoizedState = [r, t], r;
			},
			useReducer: function(e, t, n) {
				var r = Yt();
				if (n !== void 0) {
					var i = n(t);
					if (ud) {
						oe(!0);
						try {
							n(t);
						} finally {
							oe(!1);
						}
					}
				} else i = t;
				return r.memoizedState = r.baseState = i, e = {
					pending: null,
					lanes: 0,
					dispatch: null,
					lastRenderedReducer: e,
					lastRenderedState: i
				}, r.queue = e, e = e.dispatch = qn.bind(null, K, e), [r.memoizedState, e];
			},
			useRef: function(e) {
				var t = Yt();
				return e = { current: e }, t.memoizedState = e;
			},
			useState: function(e) {
				e = fn(e);
				var t = e.queue, n = Jn.bind(null, K, t);
				return t.dispatch = n, [e.memoizedState, n];
			},
			useDebugValue: In,
			useDeferredValue: function(e, t) {
				return zn(Yt(), e, t);
			},
			useTransition: function() {
				var e = fn(!1);
				return e = Vn.bind(null, K, e.queue, !0, !1), Yt().memoizedState = e, [!1, e];
			},
			useSyncExternalStore: function(e, t, n) {
				var i = K, a = Yt();
				if (G) {
					if (n === void 0) throw Error(r(407));
					n = n();
				} else {
					if (n = t(), X === null) throw Error(r(349));
					Q & 127 || sn(i, t, n);
				}
				a.memoizedState = n;
				var o = {
					value: n,
					getSnapshot: t
				};
				return a.queue = o, On(ln.bind(null, i, o, e), [e]), i.flags |= 2048, wn(9, { destroy: void 0 }, cn.bind(null, i, o, n, t), null), n;
			},
			useId: function() {
				var e = Yt(), t = X.identifierPrefix;
				if (G) {
					var n = du, r = uu;
					n = (r & ~(1 << 32 - Al(r) - 1)).toString(32) + n, t = "_" + t + "R_" + n, n = dd++, 0 < n && (t += "H" + n.toString(32)), t += "_";
				} else n = md++, t = "_" + t + "r_" + n.toString(32) + "_";
				return e.memoizedState = t;
			},
			useHostTransitionStatus: Un,
			useFormState: yn,
			useActionState: yn,
			useOptimistic: function(e) {
				var t = Yt();
				t.memoizedState = t.baseState = e;
				var n = {
					pending: null,
					lanes: 0,
					dispatch: null,
					lastRenderedReducer: null,
					lastRenderedState: null
				};
				return t.queue = n, t = Xn.bind(null, K, !0, n), n.dispatch = t, [e, t];
			},
			useMemoCache: en,
			useCacheRefresh: function() {
				return Yt().memoizedState = Kn.bind(null, K);
			},
			useEffectEvent: function(e) {
				var t = Yt(), n = { impl: e };
				return t.memoizedState = n, function() {
					if (Y & 2) throw Error(r(440));
					return n.impl.apply(void 0, arguments);
				};
			}
		}, _d = {
			readContext: Re,
			use: $t,
			useCallback: Ln,
			useContext: Re,
			useEffect: kn,
			useImperativeHandle: Fn,
			useInsertionEffect: Mn,
			useLayoutEffect: Nn,
			useMemo: Rn,
			useReducer: nn,
			useRef: Tn,
			useState: function() {
				return nn(tn);
			},
			useDebugValue: In,
			useDeferredValue: function(e, t) {
				return Bn(Xt(), q.memoizedState, e, t);
			},
			useTransition: function() {
				var e = nn(tn)[0], t = Xt().memoizedState;
				return [typeof e == "boolean" ? e : Qt(e), t];
			},
			useSyncExternalStore: on,
			useId: Wn,
			useHostTransitionStatus: Un,
			useFormState: bn,
			useActionState: bn,
			useOptimistic: function(e, t) {
				return pn(Xt(), q, e, t);
			},
			useMemoCache: en,
			useCacheRefresh: Gn,
			useEffectEvent: jn
		}, vd = {
			readContext: Re,
			use: $t,
			useCallback: Ln,
			useContext: Re,
			useEffect: kn,
			useImperativeHandle: Fn,
			useInsertionEffect: Mn,
			useLayoutEffect: Nn,
			useMemo: Rn,
			useReducer: an,
			useRef: Tn,
			useState: function() {
				return an(tn);
			},
			useDebugValue: In,
			useDeferredValue: function(e, t) {
				var n = Xt();
				return q === null ? zn(n, e, t) : Bn(n, q.memoizedState, e, t);
			},
			useTransition: function() {
				var e = an(tn)[0], t = Xt().memoizedState;
				return [typeof e == "boolean" ? e : Qt(e), t];
			},
			useSyncExternalStore: on,
			useId: Wn,
			useHostTransitionStatus: Un,
			useFormState: Cn,
			useActionState: Cn,
			useOptimistic: function(e, t) {
				var n = Xt();
				return q === null ? (n.baseState = e, [e, n.queue.dispatch]) : pn(n, q, e, t);
			},
			useMemoCache: en,
			useCacheRefresh: Gn,
			useEffectEvent: jn
		}, yd = {
			enqueueSetState: function(e, t, n) {
				e = e._reactInternals;
				var r = Sa(), i = xt(r);
				i.payload = t, n != null && (i.callback = n), t = St(e, i, r), t !== null && (Ta(t, e, r), Ct(t, e, r));
			},
			enqueueReplaceState: function(e, t, n) {
				e = e._reactInternals;
				var r = Sa(), i = xt(r);
				i.tag = 1, i.payload = t, n != null && (i.callback = n), t = St(e, i, r), t !== null && (Ta(t, e, r), Ct(t, e, r));
			},
			enqueueForceUpdate: function(e, t) {
				e = e._reactInternals;
				var n = Sa(), r = xt(n);
				r.tag = 2, t != null && (r.callback = t), t = St(e, r, n), t !== null && (Ta(t, e, n), Ct(t, e, n));
			}
		}, bd = Error(r(461)), xd = !1, Sd = {
			dehydrated: null,
			treeContext: null,
			retryLane: 0,
			hydrationErrors: null
		}, Cd = !1, wd = !1, Td = null, Ed = null, Dd = 0, Od = !1, J = !1, kd = !1, Ad = !1, jd = typeof WeakSet == "function" ? WeakSet : Set, Md = null, Nd = !1, Pd = !1, Fd = !1, Id = !1, Ld = null, Rd = !1, zd = null, Bd = 8192, Vd = {
			getCacheForType: function(e) {
				var t = Re(Du), n = t.data.get(e);
				return n === void 0 && (n = e(), t.data.set(e, n)), n;
			},
			cacheSignal: function() {
				return Re(Du).controller.signal;
			}
		}, Hd = 0, Ud = 1, Wd = 2, Gd = 3, Kd = 4;
		if (typeof Symbol == "function" && Symbol.for) {
			var qd = Symbol.for;
			Hd = qd("selector.component"), Ud = qd("selector.has_pseudo_class"), Wd = qd("selector.role"), Gd = qd("selector.test_id"), Kd = qd("selector.text");
		}
		var Jd = typeof WeakMap == "function" ? WeakMap : Map, Y = 0, X = null, Z = null, Q = 0, $ = 0, Yd = null, Xd = !1, Zd = !1, Qd = !1, $d = 0, ef = 0, tf = 0, nf = 0, rf = 0, af = 0, of = 0, sf = null, cf = null, lf = !1, uf = 0, df = 0, ff = Infinity, pf = null, mf = null, hf = 0, gf = null, _f = null, vf = 0, yf = 0, bf = null, xf = null, Sf = null, Cf = null, wf = null, Tf = 0, Ef = null;
		return R.attemptContinuousHydration = function(e) {
			if (e.tag === 13 || e.tag === 31) {
				var t = gt(e, 67108864);
				t !== null && Ta(t, e, 67108864), Co(e, 67108864);
			}
		}, R.attemptHydrationAtCurrentPriority = function(e) {
			if (e.tag === 13 || e.tag === 31) {
				var t = Sa();
				t = ie(t);
				var n = gt(e, t);
				n !== null && Ta(n, e, t), Co(e, t);
			}
		}, R.attemptSynchronousHydration = function(e) {
			switch (e.tag) {
				case 3:
					if (e = e.stateNode, e.current.memoizedState.isDehydrated) {
						var t = g(e.pendingLanes);
						if (t !== 0) {
							for (e.pendingLanes |= 2, e.entangledLanes |= 2; t;) {
								var n = 1 << 31 - Al(t);
								e.entanglements[1] |= n, t &= ~n;
							}
							Ke(e), !(Y & 6) && (ff = Bl() + 500, qe(0, !1));
						}
					}
					break;
				case 31:
				case 13: t = gt(e, 2), t !== null && Ta(t, e, 2), Aa(), Co(e, 2);
			}
		}, R.batchedUpdates = function(e, t) {
			return e(t);
		}, R.createComponentSelector = function(e) {
			return {
				$$typeof: Hd,
				value: e
			};
		}, R.createContainer = function(e, t, n, r, i, a, o, s, c, l) {
			return vo(e, t, !1, null, n, r, a, null, o, s, c, l);
		}, R.createHasPseudoClassSelector = function(e) {
			return {
				$$typeof: Ud,
				value: e
			};
		}, R.createHydrationContainer = function(e, t, n, r, i, a, o, s, c, l, u, d, f, p) {
			return e = vo(n, r, !0, e, i, a, s, p, c, l, u, d), e.context = yo(null), n = e.current, r = Sa(), r = ie(r), i = xt(r), i.callback = t ?? null, St(n, i, r), t = r, e.current.lanes = t, x(e, t), Ke(e), e;
		}, R.createPortal = function(e, t, n) {
			var r = 3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
			return {
				$$typeof: Oo,
				key: r == null ? null : r === Go ? Go : "" + r,
				children: e,
				containerInfo: t,
				implementation: n
			};
		}, R.createRoleSelector = function(e) {
			return {
				$$typeof: Wd,
				value: e
			};
		}, R.createTestNameSelector = function(e) {
			return {
				$$typeof: Gd,
				value: e
			};
		}, R.createTextSelector = function(e) {
			return {
				$$typeof: Kd,
				value: e
			};
		}, R.defaultOnCaughtError = function(e) {
			console.error(e);
		}, R.defaultOnRecoverableError = function(e) {
			Zl(e);
		}, R.defaultOnUncaughtError = function(e) {
			Zl(e);
		}, R.deferredUpdates = function(e) {
			var t = B.T, n = gs();
			try {
				return hs(32), B.T = null, e();
			} finally {
				hs(n), B.T = t;
			}
		}, R.discreteUpdates = function(e, t, n, r, i) {
			var a = B.T, o = gs();
			try {
				return hs(2), B.T = null, e(t, n, r, i);
			} finally {
				hs(o), B.T = a, Y === 0 && (ff = Bl() + 500);
			}
		}, R.findAllNodes = xa, R.findBoundingRects = function(e, t) {
			if (!Ns) throw Error(r(363));
			t = xa(e, t), e = [];
			for (var n = 0; n < t.length; n++) e.push(Fs(t[n]));
			for (t = e.length - 1; 0 < t; t--) {
				n = e[t];
				for (var i = n.x, a = i + n.width, o = n.y, s = o + n.height, c = t - 1; 0 <= c; c--) if (t !== c) {
					var l = e[c], u = l.x, d = u + l.width, f = l.y, p = f + l.height;
					if (i >= u && o >= f && a <= d && s <= p) {
						e.splice(t, 1);
						break;
					}
					if (!(i !== u || n.width !== l.width || p < o || f > s)) {
						f > o && (l.height += f - o, l.y = o), p < s && (l.height = s - f), e.splice(t, 1);
						break;
					}
					if (!(o !== f || n.height !== l.height || d < i || u > a)) {
						u > i && (l.width += u - i, l.x = i), d < a && (l.width = a - u), e.splice(t, 1);
						break;
					}
				}
			}
			return e;
		}, R.findHostInstance = bo, R.findHostInstanceWithNoPortals = function(e) {
			return e = o(e), e = e === null ? null : c(e), e === null ? null : Zo(e.stateNode);
		}, R.findHostInstanceWithWarning = function(e) {
			return bo(e);
		}, R.flushPassiveEffects = to, R.flushSyncFromReconciler = function(e) {
			var t = Y;
			Y |= 1;
			var n = B.T, r = gs();
			try {
				if (hs(2), B.T = null, e) return e();
			} finally {
				hs(r), B.T = n, Y = t, !(Y & 6) && qe(0, !1);
			}
		}, R.flushSyncWork = Aa, R.focusWithin = function(e, t) {
			if (!Ns) throw Error(r(363));
			for (e = _a(e), t = ba(e, t), t = Array.from(t), e = 0; e < t.length;) {
				var n = t[e++], i = n.tag;
				if (!Ls(n)) {
					if ((i === 5 || i === 26 || i === 27) && zs(n.stateNode)) return !0;
					for (n = n.child; n !== null;) t.push(n), n = n.sibling;
				}
			}
			return !1;
		}, R.getFindAllNodesFailureDescription = function(e, t) {
			if (!Ns) throw Error(r(363));
			var n = 0, i = [];
			e = [_a(e), 0];
			for (var a = 0; a < e.length;) {
				var o = e[a++], s = o.tag, c = e[a++], l = t[c];
				if ((s !== 5 && s !== 26 && s !== 27 || !Ls(o)) && (va(o, l) && (i.push(ya(l)), c++, c > n && (n = c)), c < t.length)) for (o = o.child; o !== null;) e.push(o, c), o = o.sibling;
			}
			if (n < t.length) {
				for (e = []; n < t.length; n++) e.push(ya(t[n]));
				return "findAllNodes was able to match part of the selector:\n  " + (i.join(" > ") + "\n\nNo matching component was found for:\n  ") + e.join(" > ");
			}
			return null;
		}, R.getPublicRootInstance = function(e) {
			if (e = e.current, !e.child) return null;
			switch (e.child.tag) {
				case 27:
				case 5: return Zo(e.child.stateNode);
				default: return e.child.stateNode;
			}
		}, R.injectIntoDevTools = function() {
			var e = {
				bundleType: 0,
				version: Jo,
				rendererPackageName: Yo,
				currentDispatcherRef: B,
				reconcilerVersion: "19.3.0"
			};
			if (Xo !== null && (e.rendererConfig = Xo), typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u") e = !1;
			else {
				var t = __REACT_DEVTOOLS_GLOBAL_HOOK__;
				if (t.isDisabled || !t.supportsFiber) e = !0;
				else {
					try {
						ql = t.inject(e), Jl = t;
					} catch {}
					e = !!t.checkDCE;
				}
			}
			return e;
		}, R.isAlreadyRendering = function() {
			return !!(Y & 6);
		}, R.observeVisibleRects = function(e, t, n, i) {
			if (!Ns) throw Error(r(363));
			e = xa(e, t);
			var a = Bs(e, n, i).disconnect;
			return { disconnect: function() {
				a();
			} };
		}, R.shouldError = function() {
			return null;
		}, R.shouldSuspend = function() {
			return !1;
		}, R.startHostTransition = function(e, t, i, a) {
			if (e.tag !== 5) throw Error(r(476));
			var o = Hn(e).queue;
			Vn(e, o, t, Os, i === null ? n : function() {
				var t = Hn(e);
				return t.next === null && (t = e.alternate.memoizedState), Yn(e, t.next.queue, {}, Sa()), i(a);
			});
		}, R.updateContainer = function(e, t, n, r) {
			var i = t.current, a = Sa();
			return xo(i, a, e, t, n, r), a;
		}, R.updateContainerSync = function(e, t, n, r) {
			return xo(t.current, 2, e, t, n, r), 2;
		}, R;
	}, t.exports.default = t.exports, Object.defineProperty(t.exports, "__esModule", { value: !0 });
})), Gs = /* @__PURE__ */ c((/* @__PURE__ */ o(((e, t) => {
	t.exports = Ws();
})))(), 1), Ks = 0, qs = 32, Js = Object.freeze({
	pending: !1,
	data: null,
	method: null,
	action: null
}), Ys = (0, Pi.createContext)(Js), H = () => {}, U = () => null, W = () => !1, Xs = () => !0, Zs = (e) => vs(e.instance).adopt(e), Qs = (e) => {
	let t = e?.instance;
	if (t && typeof t.id == "number") return t.id;
	let n = e?.id;
	return typeof n == "number" ? n : 0;
}, $s = (e) => {
	let t = e?.instance;
	return typeof t == "string" ? t : t?.instance ?? (la() === "" ? ua() : la());
}, ec = "http://www.w3.org/2000/svg", tc = "http://www.w3.org/1998/Math/MathML", nc = Object.freeze({}), rc = Object.freeze({ ns: ec }), ic = Object.freeze({ ns: tc }), ac = (e, t) => t === "svg" ? rc : t === "math" ? ic : t === "foreignObject" || t === "desc" || t === "title" ? nc : e, oc = {
	rendererVersion: "0.34.0",
	rendererPackageName: "@atolljs/react-island",
	extraDevToolsConfig: null,
	isPrimaryRenderer: !0,
	warnsIfNotActing: !1,
	supportsMutation: !0,
	supportsPersistence: !1,
	supportsHydration: !1,
	supportsResources: !1,
	supportsSingletons: !1,
	supportsMicrotasks: !1,
	supportsTestSelectors: !1,
	getPublicInstance: (e) => Zs(e),
	getRootHostContext: (e) => {
		let t = e?.instance?.ns;
		return t === ec ? rc : t === tc ? ic : nc;
	},
	getChildHostContext: (e, t) => ac(e, t),
	prepareForCommit: U,
	resetAfterCommit: ma,
	createInstance: (e, t, n, r, i) => {
		let a = wa(e, t, ac(r, e).ns, $s(n));
		return N(a.instance, {
			t: "create",
			id: a.id,
			type: e,
			props: a.props,
			ns: a.ns
		}), a;
	},
	createTextInstance: (e, t, n, r) => {
		let i = Ta(e, $s(t));
		return N(i.instance, {
			t: "text",
			id: i.id,
			text: e
		}), i;
	},
	finalizeInitialChildren: W,
	shouldSetTextContent: W,
	appendInitialChild: (e, t) => {
		N(e.instance, {
			t: "append",
			parent: e.id,
			child: t.id
		});
	},
	appendChild: (e, t) => {
		N(e.instance, {
			t: "append",
			parent: e.id,
			child: t.id
		});
	},
	appendChildToContainer: (e, t) => {
		N(t.instance, {
			t: "append",
			parent: Qs(e),
			child: t.id
		});
	},
	insertBefore: (e, t, n) => {
		N(e.instance, {
			t: "append",
			parent: e.id,
			child: t.id,
			before: n.id
		});
	},
	insertInContainerBefore: (e, t, n) => {
		N(t.instance, {
			t: "append",
			parent: Qs(e),
			child: t.id,
			before: n.id
		});
	},
	removeChild: (e, t) => {
		N(t.instance, {
			t: "remove",
			child: t.id
		});
	},
	removeChildFromContainer: (e, t) => {
		N(t.instance, {
			t: "remove",
			child: t.id
		});
	},
	clearContainer: () => {
		N(la(), { t: "clear" });
	},
	commitUpdate: (e, t, n, r, i) => {
		e.props = Ca(e, r), N(e.instance, {
			t: "update",
			id: e.id,
			props: e.props
		});
	},
	commitTextUpdate: (e, t, n) => {
		e.text = n, N(e.instance, {
			t: "utext",
			id: e.id,
			text: n
		});
	},
	commitMount: H,
	resetTextContent: (e) => {
		e.props = {}, N(e.instance, {
			t: "update",
			id: e.id,
			props: {}
		});
	},
	hideInstance: (e) => {
		N(e.instance, {
			t: "update",
			id: e.id,
			props: {
				...e.props,
				hidden: !0
			}
		});
	},
	unhideInstance: (e) => {
		N(e.instance, {
			t: "update",
			id: e.id,
			props: { ...e.props }
		});
	},
	hideTextInstance: (e) => {
		N(e.instance, {
			t: "utext",
			id: e.id,
			text: ""
		});
	},
	unhideTextInstance: (e, t) => {
		N(e.instance, {
			t: "utext",
			id: e.id,
			text: t
		});
	},
	detachDeletedInstance: (e) => {
		if (ea.delete(e.id), e.kind === "element") for (let t of Object.values(e.listenerSlots)) xa(t);
	},
	scheduleTimeout: setTimeout,
	cancelTimeout: clearTimeout,
	noTimeout: -1,
	scheduleMicrotask: (e) => queueMicrotask(e),
	setCurrentUpdatePriority: (e) => {
		Ks = e;
	},
	getCurrentUpdatePriority: () => Ks,
	resolveUpdatePriority: () => Ks === 0 ? qs : Ks,
	resolveEventType: U,
	resolveEventTimeStamp: () => -1.1,
	trackSchedulerEvent: H,
	shouldAttemptEagerTransition: W,
	getInstanceFromNode: U,
	beforeActiveInstanceBlur: H,
	afterActiveInstanceBlur: H,
	preparePortalMount: H,
	prepareScopeUpdate: H,
	getInstanceFromScope: U,
	requestPostPaintCallback: H,
	maySuspendCommit: W,
	maySuspendCommitOnUpdate: W,
	maySuspendCommitInSyncRender: W,
	preloadInstance: Xs,
	startSuspendingCommit: H,
	suspendInstance: H,
	suspendOnActiveViewTransition: H,
	waitForCommitToBeReady: U,
	getSuspendedCommitReason: () => 0,
	NotPendingTransition: Js,
	HostTransitionContext: Ys,
	resetFormInstance: H,
	bindToConsole: (e, t) => console[e]?.bind(console, ...t) ?? H,
	createContainerChildSet: () => [],
	appendChildToContainerChildSet: H,
	finalizeContainerChildren: H,
	replaceContainerChildren: H,
	cloneInstance: U,
	cloneMutableInstance: (e) => e,
	cloneMutableTextInstance: (e) => e,
	cloneHiddenInstance: (e) => e,
	cloneHiddenTextInstance: (e) => e,
	createFragmentInstance: () => ({}),
	updateFragmentInstanceFiber: H,
	commitNewChildToFragmentInstance: H,
	deleteChildFromFragmentInstance: H,
	createViewTransitionInstance: (e) => ({
		name: e,
		autoName: null
	}),
	applyViewTransitionName: H,
	restoreViewTransitionName: H,
	cancelViewTransitionName: H,
	cancelRootViewTransitionName: H,
	restoreRootViewTransitionName: H,
	cloneRootViewTransitionContainer: H,
	removeRootViewTransitionClone: H,
	measureInstance: U,
	measureClonedInstance: U,
	wasInstanceInViewport: W,
	hasInstanceChanged: W,
	hasInstanceAffectedParent: W,
	startViewTransition: U,
	startGestureTransition: U,
	stopViewTransition: H,
	addViewTransitionFinishedListener: H,
	getCurrentGestureOffset: () => 0,
	isSuspenseInstancePending: W,
	isSuspenseInstanceFallback: W,
	getSuspenseInstanceFallbackErrorDetails: () => ({}),
	registerSuspenseInstanceRetry: H,
	getNextHydratableSibling: U,
	getNextHydratableSiblingAfterSingleton: U,
	getFirstHydratableChild: U,
	getFirstHydratableChildWithinContainer: U,
	getFirstHydratableChildWithinActivityInstance: U,
	getFirstHydratableChildWithinSingleton: U,
	getFirstHydratableChildWithinSuspenseInstance: U,
	canHydrateInstance: U,
	canHydrateTextInstance: U,
	canHydrateActivityInstance: U,
	canHydrateSuspenseInstance: U,
	canHydrateFormStateMarker: U,
	isFormStateMarkerMatching: W,
	hydrateInstance: H,
	hydrateTextInstance: H,
	hydrateActivityInstance: H,
	hydrateSuspenseInstance: H,
	getNextHydratableInstanceAfterActivityInstance: U,
	getNextHydratableInstanceAfterSuspenseInstance: U,
	commitHydratedInstance: H,
	commitHydratedContainer: H,
	commitHydratedSuspenseInstance: H,
	finalizeHydratedChildren: W,
	flushHydrationEvents: H,
	clearActivityBoundary: W,
	clearSuspenseBoundary: W,
	clearActivityBoundaryFromContainer: W,
	clearSuspenseBoundaryFromContainer: W,
	hideDehydratedBoundary: H,
	unhideDehydratedBoundary: H,
	shouldDeleteUnhydratedTailInstances: W,
	diffHydratedPropsForDevWarnings: U,
	diffHydratedTextForDevWarnings: U,
	describeHydratableInstanceForDevWarnings: U,
	validateHydratableInstance: Xs,
	validateHydratableTextInstance: Xs,
	isHostHoistableType: W,
	getHoistableRoot: U,
	getResource: U,
	acquireResource: H,
	releaseResource: H,
	hydrateHoistable: H,
	mountHoistable: H,
	unmountHoistable: H,
	createHoistableInstance: U,
	prepareToCommitHoistables: H,
	mayResourceSuspendCommit: W,
	preloadResource: Xs,
	suspendResource: H,
	resolveSingletonInstance: U,
	acquireSingletonInstance: H,
	releaseSingletonInstance: H,
	isHostSingletonType: W,
	isSingletonScope: W,
	findFiberRoot: U,
	getBoundingRect: U,
	getTextContent: U,
	isHiddenSubtree: W,
	matchAccessibilityRole: W,
	setFocusIfFocusable: W,
	setupIntersectionObserver: H
};
//#endregion
//#region ../../packages/react-island/src/reactInstance.ts
function sc(e) {
	let t = (0, Gs.default)(oc), n = t.createContainer({
		id: 0,
		instance: e
	}, 0, null, !1, null, "", console.error, console.error, console.error, null);
	return {
		reconciler: t,
		container: n,
		sync: (e) => {
			t.flushSyncFromReconciler(e), t.flushSyncWork();
		},
		render: (e) => t.updateContainer(e, n, null, null),
		unmountTree: () => t.updateContainer(null, n, null, null),
		flush: () => {
			t.flushPassiveEffects(), t.flushSyncWork();
		}
	};
}
//#endregion
//#region ../../node_modules/react/cjs/react-jsx-runtime.production.js
var cc = /* @__PURE__ */ o(((e) => {
	var t = Symbol.for("react.transitional.element");
	function n(e, n, r) {
		var i = null;
		if (r !== void 0 && (i = "" + r), n.key !== void 0 && (i = "" + n.key), "key" in n) for (var a in r = {}, n) a !== "key" && (r[a] = n[a]);
		else r = n;
		return n = r.ref, {
			$$typeof: t,
			type: e,
			key: i,
			ref: n === void 0 ? null : n,
			props: r
		};
	}
	e.jsx = n, e.jsxs = n;
})), lc = (/* @__PURE__ */ o(((e, t) => {
	t.exports = cc();
})))(), uc = /* @__PURE__ */ o(((e) => {
	u().__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
}));
(/* @__PURE__ */ o(((e, t) => {
	function n() {
		if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u" && typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE == "function") try {
			__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n);
		} catch (e) {
			console.error(e);
		}
	}
	n(), t.exports = uc();
})))();
//#endregion
//#region ../../packages/react-island/src/worker.ts
function dc(e, t) {
	let n = {
		renderer: "react",
		mount({ instance: t, props: n }) {
			let r = sc(t), i = (t) => r.sync(() => r.render((0, Pi.createElement)(e, t)));
			return i(n), {
				update: i,
				sync: (e) => r.sync(e),
				dispose: () => r.sync(() => r.unmountTree()),
				flush: () => r.flush()
			};
		}
	}, r = Hi(e);
	return r !== void 0 && (n.islandAppName = r), t === void 0 ? n : zi(t, n);
}
function fc(e, t) {
	let n = typeof e == "function" ? dc(e) : e;
	return Vs(t?.contract === void 0 ? n : zi(t.contract, n), t);
}
//#endregion
//#region src/mfe/counter.contract.ts
var pc = "about:blank", mc = Li({
	app: "counter",
	props: A.object({ label: A.string().optional() }),
	events: { incremented: A.object({
		count: A.number(),
		label: A.string()
	}) },
	worker: () => new Worker(pc, { type: "module" })
}), hc = (e) => e;
function gc({ label: e = "react mfe" }) {
	let [t, n] = (0, Pi.useState)(0);
	return /* @__PURE__ */ (0, lc.jsxs)("div", {
		className: "mfe-card",
		children: [/* @__PURE__ */ (0, lc.jsxs)("span", {
			className: "mfe-heading",
			children: [
				e,
				": ",
				t
			]
		}), /* @__PURE__ */ (0, lc.jsx)("button", {
			className: "mfe-btn",
			onClick: hc(() => {
				let r = t + 1;
				n(r), Sa("incremented", {
					count: r,
					label: e
				});
			}),
			children: "increment"
		})]
	});
}
var _c = fc(gc, { contract: mc });
//#endregion
export { _c as counterWorker };
