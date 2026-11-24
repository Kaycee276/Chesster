function createEnvelope(ctx: AudioContext, volume: number, start: number, end: number): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.001, end);
  gain.connect(ctx.destination);
  return gain;
}

function createNoiseBuffer(ctx: AudioContext, duration: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.random() * 2 - 1;
  }
  return buffer;
}

/** A filtered noise impact and a ringing partial share the same audio clock. */
export function playMetallicTone(
  ctx: AudioContext, frequency: number, duration: number, volume: number, delay: number,
): void {
  const start = ctx.currentTime + delay;
  let nodes: AudioNode[] = [];
  const track = <T extends AudioNode>(node: T): T => {
    nodes = [...nodes, node];
    return node;
  };
  try {
    const noise = track(ctx.createBufferSource());
    const filter = track(ctx.createBiquadFilter());
    const noiseGain = track(createEnvelope(ctx, volume, start, start + duration));
    const resonance = track(ctx.createOscillator());
    const resonanceGain = track(createEnvelope(ctx, volume * 0.35, start, start + duration + 0.04));
    noise.buffer = createNoiseBuffer(ctx, duration);
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(frequency * 2, start);
    filter.Q.setValueAtTime(8, start);
    noise.connect(filter);
    filter.connect(noiseGain);
    resonance.type = "sine";
    resonance.frequency.setValueAtTime(frequency * 2, start);
    resonance.connect(resonanceGain);
    noise.onended = () => [noise, filter, noiseGain].forEach((node) => node.disconnect());
    resonance.onended = () => [resonance, resonanceGain].forEach((node) => node.disconnect());
    noise.start(start);
    noise.stop(start + duration);
    resonance.start(start);
    resonance.stop(start + duration + 0.05);
  } catch (error) {
    nodes.forEach((node) => node.disconnect());
    console.warn("Could not synthesize the metallic chess sound.", error);
  }
}
