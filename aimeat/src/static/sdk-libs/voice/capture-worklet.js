/**
 * @file voice/capture-worklet.js
 * @description Batches mono microphone samples on the audio rendering thread.
 * @structure captureWorkletSource, loaded once per capture AudioContext
 * @usage context.audioWorklet.addModule(URL.createObjectURL(new Blob([captureWorkletSource])))
 * @version-history v1.1.0 - 2026-09-19 - Replace deprecated ScriptProcessor capture.
 */
export const captureWorkletSource = `
class AimeatVoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(1024);
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.samples[this.offset++] = input[i];
      if (this.offset === this.samples.length) {
        this.port.postMessage(this.samples, [this.samples.buffer]);
        this.samples = new Float32Array(1024);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('aimeat-voice-capture', AimeatVoiceCapture);
`;
