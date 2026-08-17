// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/storage/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-storage.js (with a per-node config prelude).
"use strict";
(() => {
  // src/static/sdk-libs/_core/config.js
  function cfg() {
    return window.__AIMEAT_SDK_CFG__ || { nodeId: "", baseUrl: "" };
  }
  function resolveNodeUrl() {
    const meta = document.querySelector('meta[name="aimeat-node"]');
    if (meta) return (meta.getAttribute("content") || "").replace(/\/$/, "");
    if (location.protocol === "http:" || location.protocol === "https:") return location.origin;
    return cfg().baseUrl;
  }
  var NODE_URL = resolveNodeUrl();
  var APEX_URL = cfg().baseUrl;
  var NODE_ID = cfg().nodeId;
  var HEARTBEAT_MS = cfg().heartbeatMs || 3e4;

  // src/static/sdk-libs/_core/session.js
  function getSession(libLabel) {
    const auth = window.AIMEAT && window.AIMEAT.auth;
    if (!auth) {
      throw new Error("AIMEAT.auth is required. Include aimeat-auth.js before " + (libLabel || "this library"));
    }
    const s = auth.getSession();
    if (!s) throw new Error("Not logged in. Call AIMEAT.auth.login() first.");
    return s;
  }
  function authFetch(path, opts, libLabel) {
    return getSession(libLabel).fetch(path, opts);
  }
  function makeSession(libLabel) {
    return {
      getSession: () => getSession(libLabel),
      authFetch: (path, opts) => authFetch(path, opts, libLabel)
    };
  }

  // src/static/sdk-libs/_core/namespace.js
  function namespace() {
    if (!window.AIMEAT) window.AIMEAT = {};
    return window.AIMEAT;
  }
  function attach(key, value) {
    const ns = namespace();
    ns[key] = value;
    return ns;
  }

  // src/static/sdk-libs/storage/index.js
  var { getSession: getSession2, authFetch: authFetch2 } = makeSession("aimeat-storage.js");
  var storage = {
    // Upload a file (File object, Blob, or base64 string)
    async upload(fileOrData, opts) {
      let key, data, mime_type, visibility;
      if (fileOrData instanceof File || fileOrData instanceof Blob) {
        const file = (
          /** @type {File} */
          fileOrData
        );
        key = opts?.key || file.name || "file-" + Date.now();
        mime_type = opts?.mime_type || file.type || "application/octet-stream";
        visibility = opts?.visibility || "private";
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        }
        data = btoa(binary);
      } else if (typeof fileOrData === "string") {
        key = opts?.key || "file-" + Date.now();
        data = fileOrData;
        mime_type = opts?.mime_type || "application/octet-stream";
        visibility = opts?.visibility || "private";
      } else {
        throw new Error("upload() expects a File, Blob, or base64 string");
      }
      const res = await authFetch2("/v1/storage", {
        method: "POST",
        body: JSON.stringify({ key, data, mime_type, visibility })
      });
      if (!res.ok) throw new Error(res.error?.message || "Upload failed");
      return res.data;
    },
    // Download a file as Blob
    async download(key) {
      const session = getSession2();
      const jwt = session.jwt;
      const r = await fetch(NODE_URL + "/v1/storage/" + encodeURIComponent(key), {
        headers: { "Authorization": "Bearer " + jwt }
      });
      if (!r.ok) throw new Error("Download failed: " + r.status);
      return r.blob();
    },
    // Get a direct URL for embedding (e.g. in <img src="">)
    // Note: requires auth header, so only works with public files or session.fetch
    publicUrl(key) {
      return NODE_URL + "/v1/storage/" + encodeURIComponent(key);
    },
    /**
     * A URL that will actually LOAD in an <img>, a <video> or a new tab, for a file that is not public.
     *
     * The problem this exists for: a browser does not send an Authorization header when it fetches an
     * image, so `<img src="/v1/pub/alice@node/receipt.jpg">` on a private file draws a broken icon
     * even for the person who owns it. The node answers `?mode=handle` with a presigned, short-lived
     * address that carries its own permission, and that one loads anywhere.
     *
     * Takes what a table actually holds: a full address, a `/v1/pub/...` path, or a bare key of the
     * signed-in person's own. A public file is handed back unchanged, because it already works and a
     * presigned URL for it would only add an expiry it does not need.
     *
     * The URL expires. Fetch it when you are about to show the picture, not when you load the page.
     */
    async viewUrl(addressOrKey, opts) {
      const session = getSession2();
      const value = String(addressOrKey || "").trim();
      if (!value) throw new Error("viewUrl() needs an address or a key");
      let path;
      if (/^https?:\/\//i.test(value)) {
        try {
          path = new URL(value).pathname;
        } catch {
          return value;
        }
      } else if (value.startsWith("/v1/pub/")) {
        path = value;
      } else {
        path = "/v1/pub/" + encodeURIComponent(session.ghii || session.owner || "") + "/" + value.split("/").map(encodeURIComponent).join("/");
      }
      if (path.indexOf("/v1/pub/") !== 0) return value;
      const ownerGaii = decodeURIComponent(path.slice("/v1/pub/".length).split("/")[0] || "");
      const ourNode = String(session.ghii || "").split("@")[1];
      if (ourNode && ownerGaii.indexOf("@") !== -1 && ownerGaii.split("@")[1] !== ourNode) return value;
      const url = NODE_URL + path;
      const r = await fetch(url + "?mode=handle", {
        headers: session.jwt ? { "Authorization": "Bearer " + session.jwt } : {}
      });
      if (!r.ok) throw new Error("Could not open that file: " + r.status);
      const body = await r.json();
      const data = body.data || body;
      if (data.visibility === "public" && !(opts && opts.forceSigned)) return url;
      return data.download_url;
    },
    // List all files
    async list() {
      const res = await authFetch2("/v1/storage");
      if (!res.ok) throw new Error(res.error?.message || "Failed to list files");
      return res.data;
    },
    // Get file metadata (HEAD request)
    async metadata(key) {
      const session = getSession2();
      const jwt = session.jwt;
      const r = await fetch(NODE_URL + "/v1/storage/" + encodeURIComponent(key), {
        method: "HEAD",
        headers: { "Authorization": "Bearer " + jwt }
      });
      if (!r.ok) throw new Error("Metadata fetch failed: " + r.status);
      return {
        contentType: r.headers.get("Content-Type"),
        contentLength: parseInt(r.headers.get("Content-Length") || "0"),
        visibility: r.headers.get("X-AIMEAT-Visibility"),
        createdAt: r.headers.get("X-AIMEAT-Created")
      };
    },
    // Delete a file
    async delete(key) {
      const res = await authFetch2("/v1/storage/" + encodeURIComponent(key), { method: "DELETE" });
      if (!res.ok) throw new Error(res.error?.message || "Delete failed");
      return res.data;
    },
    // ── Chunked upload for large files ──
    async uploadChunked(file, opts) {
      const chunkSize = opts?.chunkSize || 1024 * 1024;
      const key = opts?.key || file.name || "file-" + Date.now();
      const mime_type = opts?.mime_type || file.type || "application/octet-stream";
      const visibility = opts?.visibility || "private";
      const totalChunks = Math.ceil(file.size / chunkSize);
      const initRes = await authFetch2("/v1/storage/upload/init", {
        method: "POST",
        body: JSON.stringify({ key, mime_type, visibility, chunk_size: chunkSize, total_chunks: totalChunks })
      });
      if (!initRes.ok) throw new Error(initRes.error?.message || "Chunked upload init failed");
      const uploadId = initRes.data.upload_id;
      const session = getSession2();
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, file.size);
        const chunk = file.slice(start, end);
        const buf = await chunk.arrayBuffer();
        const r = await fetch(NODE_URL + "/v1/storage/upload/" + uploadId + "/" + i, {
          method: "PUT",
          headers: {
            "Authorization": "Bearer " + session.jwt,
            "Content-Type": "application/octet-stream"
          },
          body: buf
        });
        if (!r.ok) throw new Error("Chunk " + i + " upload failed: " + r.status);
        if (opts?.onProgress) opts.onProgress({ chunk: i, total: totalChunks, percent: Math.round((i + 1) / totalChunks * 100) });
      }
      const completeRes = await authFetch2("/v1/storage/upload/" + uploadId + "/complete", { method: "POST" });
      if (!completeRes.ok) throw new Error(completeRes.error?.message || "Chunked upload complete failed");
      return completeRes.data;
    },
    // Abort a chunked upload
    async abortUpload(uploadId) {
      const res = await authFetch2("/v1/storage/upload/" + uploadId, { method: "DELETE" });
      if (!res.ok) throw new Error(res.error?.message || "Abort failed");
      return res.data;
    },
    // ── Drag & Drop helper ──
    enableDropZone(selector, opts) {
      const el = (
        /** @type {HTMLElement} */
        typeof selector === "string" ? document.querySelector(selector) : selector
      );
      if (!el) throw new Error("Drop zone element not found: " + selector);
      const accept = opts?.accept || "*/*";
      const maxSize = opts?.maxSize || 10 * 1024 * 1024;
      el.addEventListener("dragover", (e) => {
        e.preventDefault();
        el.style.outline = "2px dashed #38bdf8";
      });
      el.addEventListener("dragleave", () => {
        el.style.outline = "";
      });
      el.addEventListener("drop", async (e) => {
        e.preventDefault();
        el.style.outline = "";
        const files = Array.from(e.dataTransfer.files);
        for (const file of files) {
          if (accept !== "*/*" && !file.type.match(accept.replace("*", ".*"))) {
            if (opts?.onError) opts.onError(new Error("File type not accepted: " + file.type));
            continue;
          }
          if (file.size > maxSize) {
            if (opts?.onError) opts.onError(new Error("File too large: " + file.name + " (" + file.size + " bytes)"));
            continue;
          }
          try {
            const ref = await storage.upload(file, opts);
            if (opts?.onUpload) opts.onUpload(ref, file);
          } catch (err) {
            if (opts?.onError) opts.onError(err);
          }
        }
      });
    }
  };
  attach("storage", storage);
})();
