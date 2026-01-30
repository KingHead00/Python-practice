const output = document.getElementById("consoleOutput");
const status = document.getElementById("status");
const runBtn = document.getElementById("runBtn");
const stopBtn = document.getElementById("stopBtn");

// 1. Diagnostic Logger
function log(msg, isError = false) {
    const div = document.createElement("div");
    div.style.color = isError? "var(--error-red)" : "#94a3b8";
    div.style.fontSize = "12px";
    div.textContent = "> " + msg;
    output.appendChild(div);
}

// 2. Initialize Editor
const editor = CodeMirror.fromTextArea(document.getElementById("editorTextarea"), {
    mode: "python",
    theme: "dracula",
    lineNumbers: true
});

// 3. Setup Shared Memory
let sab, sInt32, sUint8, worker = null;

if (typeof SharedArrayBuffer === "undefined") {
    status.textContent = "SECURITY ERROR";
    status.classList.add("error");
    log("CRITICAL: SharedArrayBuffer is blocked by your browser.", true);
    log("This happens because the required Vercel security headers (COOP/COEP) are not active.", true);
} else {
    sab = new SharedArrayBuffer(1024 * 64); 
    sInt32 = new Int32Array(sab);
    sUint8 = new Uint8Array(sab);
    status.textContent = "READY";
    status.classList.add("ready");
    runBtn.disabled = false;
    log("Engine ready. Environment is isolated.");
}

// 4. Handle Python Input Request
function handleStdinRequest() {
    const inputLine = document.createElement("span");
    inputLine.className = "console-input-line";
    inputLine.contentEditable = "true";
    output.appendChild(inputLine);
    inputLine.focus();

    inputLine.onkeydown = (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            const val = inputLine.textContent + "\n";
            inputLine.contentEditable = "false";
            
            const encoded = new TextEncoder().encode(val);
            sUint8.set(encoded, 8); // Offset metadata
            sInt32[1] = encoded.length;
            Atomics.store(sInt32, 0, 1); // Unlock worker
            Atomics.notify(sInt32, 0);
            output.appendChild(document.createElement("br"));
        }
    };
}

// 5. Worker Management
runBtn.onclick = () => {
    output.innerHTML = "";
    runBtn.disabled = true;
    stopBtn.disabled = false;
    status.textContent = "RUNNING...";

    if (worker) worker.terminate();

    const workerCode = `
        importScripts("https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js");
        let pyodide, sInt32, sUint8;

        self.onmessage = async (e) => {
            const { code, sab } = e.data;
            sInt32 = new Int32Array(sab);
            sUint8 = new Uint8Array(sab);

            if (!pyodide) {
                pyodide = await loadPyodide();
                pyodide.setStdout({ batched: (s) => self.postMessage({ type: "out", text: s }) });
                pyodide.setStdin({
                    read(buffer) {
                        self.postMessage({ type: "stdin" });
                        Atomics.wait(sInt32, 0, 0); // Worker sleeps here
                        const len = sInt32[1];
                        buffer.set(sUint8.slice(8, 8 + len));
                        Atomics.store(sInt32, 0, 0);
                        return len;
                    }
                });
            }

            try {
                await pyodide.runPythonAsync(code);
            } catch (err) {
                self.postMessage({ type: "out", text: err.toString() });
            }
            self.postMessage({ type: "done" });
        };
    `;

    worker = new Worker(URL.createObjectURL(new Blob([workerCode], {type: 'application/javascript'})));
    
    worker.onmessage = (e) => {
        if (e.data.type === "out") output.innerHTML += `<span>${e.data.text}</span>`;
        if (e.data.type === "stdin") handleStdinRequest();
        if (e.data.type === "done") resetUI();
    };

    worker.postMessage({ code: editor.getValue(), sab: sab });
};

function resetUI() {
    runBtn.disabled = false;
    stopBtn.disabled = true;
    status.textContent = "READY";
}

stopBtn.onclick = () => {
    if (worker) worker.terminate();
    worker = null;
    resetUI();
    log("Execution Interrupted.", true);
};

document.getElementById("clearBtn").onclick = () => output.innerHTML = "";
