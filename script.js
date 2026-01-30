const output = document.getElementById("consoleOutput");
const status = document.getElementById("status");
const runBtn = document.getElementById("runBtn");
const stopBtn = document.getElementById("stopBtn");

// 1. Better Diagnostic Logger
function log(msg, type = "info") {
    const div = document.createElement("div");
    div.style.marginBottom = "5px";
    if (type === "error") div.style.color = "var(--error)";
    else if (type === "success") div.style.color = "var(--success)";
    else div.style.color = "var(--text-dim)";
    div.textContent = "> " + msg;
    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
}

// 2. Initialize Editor
const editor = CodeMirror.fromTextArea(document.getElementById("editorTextarea"), {
    mode: "python",
    theme: "dracula",
    lineNumbers: true,
    indentUnit: 4
});

// 3. Setup Shared Memory
let sab, sInt32, sUint8, worker = null;

if (typeof SharedArrayBuffer === "undefined") {
    status.textContent = "SECURITY BLOCKED";
    status.classList.add("error");
    log("Vercel security headers (COOP/COEP) not detected.", "error");
} else {
    sab = new SharedArrayBuffer(1024 * 64); 
    sInt32 = new Int32Array(sab);
    sUint8 = new Uint8Array(sab);
    status.textContent = "Engine Ready";
    status.classList.add("ready");
    runBtn.disabled = false;
    log("Environment Isolated. Ready to execute.", "success");
}

// 4. Input Handler
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
            inputLine.style.background = "none";
            inputLine.style.border = "none";
            
            const encoded = new TextEncoder().encode(val);
            sUint8.set(encoded, 8);
            sInt32[1] = encoded.length;
            Atomics.store(sInt32, 0, 1);
            Atomics.notify(sInt32, 0);
            output.appendChild(document.createElement("br"));
        }
    };
}

// 5. Run handling
runBtn.onclick = () => {
    output.innerHTML = "";
    runBtn.disabled = true;
    stopBtn.disabled = false;
    status.textContent = "Running...";

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
                        Atomics.wait(sInt32, 0, 0);
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
        if (e.data.type === "done") {
            runBtn.disabled = false;
            stopBtn.disabled = true;
            status.textContent = "Engine Ready";
        }
    };
    worker.postMessage({ code: editor.getValue(), sab: sab });
};

stopBtn.onclick = () => {
    if (worker) worker.terminate();
    worker = null;
    runBtn.disabled = false;
    stopBtn.disabled = true;
    status.textContent = "Interrupted";
    log("Execution Stopped.", "error");
};

document.getElementById("clearBtn").onclick = () => output.innerHTML = "";
