/**
 * VoiceInput - Browser audio capture for voice transcription
 *
 * Captures microphone input, converts to 16kHz PCM, sends via callback
 * Also provides frequency spectrum data for visualization
 */

export class VoiceInput {
  private mediaStream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private frequencyData: Uint8Array | null = null
  private sendAudio: ((data: ArrayBuffer) => void) | null = null
  private onSpectrum: ((levels: number[]) => void) | null = null
  private animationFrame: number | null = null

  public isRecording = false

  /**
   * Set callback for spectrum updates (array of 0-1 values for each frequency band)
   * Called every animation frame while recording
   */
  setSpectrumCallback(callback: ((levels: number[]) => void) | null): void {
    this.onSpectrum = callback
  }

  /**
   * Start capturing and streaming audio
   * @param sendAudio - Called with PCM ArrayBuffer for each audio chunk
   */
  async start(sendAudio: (data: ArrayBuffer) => void): Promise<boolean> {
    if (this.isRecording) return false

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })

      this.audioContext = new AudioContext({ sampleRate: 16000 })
      this.source = this.audioContext.createMediaStreamSource(this.mediaStream)
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1)
      this.sendAudio = sendAudio

      // Set up analyser for spectrum visualization
      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = 32  // Tiny FFT for fast response
      this.analyser.smoothingTimeConstant = 0.3  // Snappy response
      this.analyser.minDecibels = -90
      this.analyser.maxDecibels = -10  // Boost sensitivity
      this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount)
      this.source.connect(this.analyser)

      this.processor.onaudioprocess = (event) => {
        if (!this.isRecording || !this.sendAudio) return

        const inputData = event.inputBuffer.getChannelData(0)

        // Convert float32 [-1, 1] to int16 PCM
        const pcmData = new Int16Array(inputData.length)
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]))
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff
        }

        this.sendAudio(pcmData.buffer)
      }

      this.source.connect(this.processor)
      this.processor.connect(this.audioContext.destination)

      // Set recording flag BEFORE starting spectrum loop
      this.isRecording = true

      // Start spectrum animation loop (must be after isRecording = true)
      if (this.onSpectrum) {
        this.startSpectrumLoop()
      }

      return true
    } catch (error) {
      console.error('[VoiceInput] Failed to start:', error)
      this.cleanup()
      return false
    }
  }

  /**
   * Animation loop for spectrum data
   */
  private startSpectrumLoop(): void {
    const update = () => {
      if (!this.isRecording || !this.analyser || !this.frequencyData || !this.onSpectrum) {
        return
      }

      this.analyser.getByteFrequencyData(this.frequencyData as Uint8Array<ArrayBuffer>)

      // Extract 10 bands - we just want it to look good and reactive
      const bands = 10
      const levels: number[] = []
      const binCount = this.frequencyData.length

      // Get overall energy to detect any sound
      let totalEnergy = 0
      for (let i = 0; i < binCount; i++) {
        totalEnergy += this.frequencyData[i]
      }
      const avgEnergy = totalEnergy / binCount / 255

      for (let i = 0; i < bands; i++) {
        // Sample across available bins
        const binIndex = Math.min(i + 1, binCount - 1)
        let value = this.frequencyData[binIndex] / 255

        // Boost the signal significantly
        value = Math.pow(value, 0.5) * 2.0

        // Add some variation based on neighboring bins for liveliness
        if (avgEnergy > 0.02) {
          value += Math.random() * 0.2 * avgEnergy
        }

        levels.push(Math.min(1, value))
      }

      this.onSpectrum(levels)
      this.animationFrame = requestAnimationFrame(update)
    }

    update()
  }

  /** Stop recording */
  stop(): void {
    this.isRecording = false
    this.cleanup()
  }

  private cleanup(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame)
      this.animationFrame = null
    }
    if (this.processor) {
      this.processor.disconnect()
      this.processor.onaudioprocess = null
      this.processor = null
    }
    if (this.analyser) {
      this.analyser.disconnect()
      this.analyser = null
    }
    if (this.source) {
      this.source.disconnect()
      this.source = null
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {})
      this.audioContext = null
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop())
      this.mediaStream = null
    }
    this.sendAudio = null
    this.frequencyData = null
    // Note: onSpectrum callback is NOT cleared here intentionally
    // It's set once during setup and reused across recording sessions
  }
}
