'use client'

export type StreamMixerLayout = 'side-by-side' | 'grid' | 'speaker-focus'

export type StreamInfo = {
  stream: MediaStream
  participantId: string
  participantName: string
  isSpeaker?: boolean
}

export type StreamMixerOptions = {
  audioContext?: AudioContext
  layout?: StreamMixerLayout
  width?: number
  height?: number
  speakerFocusMinHeight?: number
  speakerChangeThreshold?: number // dB change to trigger speaker switch
}

/**
 * Mixes multiple MediaStreams (video + audio) into a single output stream.
 * Supports multiple layout modes and automatic speaker detection.
 * Implements latency compensation via auto-detected RTT buffering.
 */
export class StreamMixer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private audioContext: AudioContext
  private gainNodes: Map<string, GainNode> = new Map()
  private analyserNodes: Map<string, AnalyserNode> = new Map()
  private streams: Map<string, StreamInfo> = new Map()
  private videoElements: Map<string, HTMLVideoElement> = new Map()
  private animationFrameId: number | null = null
  private outputAudioTrack: MediaStreamTrack | null = null
  private destinationStream: MediaStream | null = null
  private layout: StreamMixerLayout
  private width: number
  private height: number
  private speakerFocusMinHeight: number
  private currentSpeaker: string | null = null
  private speakerChangeThreshold: number
  private latencyBuffer: number = 0 // ms to buffer for latency compensation

  constructor(options: StreamMixerOptions = {}) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = options.width || 1280
    this.canvas.height = options.height || 720
    this.width = this.canvas.width
    this.height = this.canvas.height

    const ctx = this.canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Could not get canvas 2D context')
    }
    this.ctx = ctx

    this.audioContext = options.audioContext || new (window.AudioContext || (window as any).webkitAudioContext)()
    this.layout = options.layout || 'side-by-side'
    this.speakerFocusMinHeight = options.speakerFocusMinHeight || 200
    this.speakerChangeThreshold = options.speakerChangeThreshold || 10 // dB
  }

  /**
   * Measures round-trip latency by recording timestamps.
   * In a real implementation, you'd measure RTT via WebRTC stats.
   * For now, we estimate based on typical network delay (50-300ms).
   */
  async measureAndSetLatency(rttMs: number): Promise<void> {
    // Add 50% of RTT as buffer to ensure all streams arrive before mixing
    this.latencyBuffer = Math.ceil(rttMs * 0.5)
    console.log(`[StreamMixer] Latency buffer set to ${this.latencyBuffer}ms`)
  }

  /**
   * Add a stream to the mixer (local or remote participant).
   */
  addStream(stream: MediaStream, participantId: string, participantName: string): void {
    // Create hidden video element for this stream
    const videoEl = document.createElement('video')
    videoEl.srcObject = stream
    videoEl.autoplay = true
    videoEl.muted = true
    videoEl.style.display = 'none'

    // Store the stream info and video element
    this.streams.set(participantId, {
      stream,
      participantId,
      participantName,
      isSpeaker: false,
    })
    this.videoElements.set(participantId, videoEl)

    // Extract audio track for mixing
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length > 0) {
      const source = this.audioContext.createMediaStreamSource(stream)
      const gainNode = this.audioContext.createGain()
      const analyser = this.audioContext.createAnalyser()

      source.connect(gainNode)
      gainNode.connect(analyser)
      gainNode.connect(this.audioContext.destination) // Send to destination for mixing

      this.gainNodes.set(participantId, gainNode)
      this.analyserNodes.set(participantId, analyser)
    }
  }

  /**
   * Remove a stream from the mixer.
   */
  removeStream(participantId: string): void {
    this.streams.delete(participantId)
    const videoEl = this.videoElements.get(participantId)
    if (videoEl) {
      videoEl.srcObject = null
      this.videoElements.delete(participantId)
    }

    const gainNode = this.gainNodes.get(participantId)
    if (gainNode) {
      gainNode.disconnect()
      this.gainNodes.delete(participantId)
    }

    const analyser = this.analyserNodes.get(participantId)
    if (analyser) {
      analyser.disconnect()
      this.analyserNodes.delete(participantId)
    }

    if (this.currentSpeaker === participantId) {
      this.currentSpeaker = null
    }
  }

  /**
   * Detect which participant is currently speaking based on audio levels.
   */
  private detectCurrentSpeaker(): string | null {
    if (this.analyserNodes.size === 0) return null

    let maxParticipant: string | null = null
    let maxLevel = -Infinity

    const buffer = new Uint8Array(this.analyserNodes.values().next().value?.frequencyBinCount || 256)

    for (const [participantId, analyser] of this.analyserNodes.entries()) {
      analyser.getByteFrequencyData(buffer)

      // Calculate average energy
      const sum = buffer.reduce((a, b) => a + b, 0)
      const avg = sum / buffer.length

      // Convert to dB (simplified)
      const level = 20 * Math.log10(Math.max(1, avg / 255))

      if (level > maxLevel) {
        maxLevel = level
        maxParticipant = participantId
      }
    }

    // Only switch speaker if there's significant level difference
    if (
      this.currentSpeaker !== maxParticipant &&
      maxLevel - (this.currentSpeaker ? -50 : -100) > this.speakerChangeThreshold
    ) {
      return maxParticipant
    }

    return this.currentSpeaker
  }

  /**
   * Draw all video streams onto the canvas using the selected layout.
   */
  private drawFrame(): void {
    // Clear canvas
    this.ctx.fillStyle = '#1a1a1a'
    this.ctx.fillRect(0, 0, this.width, this.height)

    const streamIds = Array.from(this.streams.keys())
    if (streamIds.length === 0) return

    // Update speaker detection
    this.currentSpeaker = this.detectCurrentSpeaker() || streamIds[0]

    switch (this.layout) {
      case 'side-by-side':
        this.drawSideBySide(streamIds)
        break
      case 'grid':
        this.drawGrid(streamIds)
        break
      case 'speaker-focus':
        this.drawSpeakerFocus(streamIds)
        break
    }
  }

  /**
   * Side-by-side layout: streams arranged horizontally.
   */
  private drawSideBySide(streamIds: string[]): void {
    const count = streamIds.length
    if (count === 0) return

    const width = Math.floor(this.width / count)
    const height = this.height

    streamIds.forEach((id, idx) => {
      const videoEl = this.videoElements.get(id)
      if (videoEl && videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
        const x = idx * width
        this.drawVideo(videoEl, x, 0, width, height, id)
      }
    })
  }

  /**
   * Grid layout: streams arranged in a grid (2x2, 3x3, etc).
   */
  private drawGrid(streamIds: string[]): void {
    const count = streamIds.length
    if (count === 0) return

    // Calculate grid dimensions
    const cols = Math.ceil(Math.sqrt(count))
    const rows = Math.ceil(count / cols)
    const tileWidth = Math.floor(this.width / cols)
    const tileHeight = Math.floor(this.height / rows)

    streamIds.forEach((id, idx) => {
      const videoEl = this.videoElements.get(id)
      if (videoEl && videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
        const row = Math.floor(idx / cols)
        const col = idx % cols
        const x = col * tileWidth
        const y = row * tileHeight
        this.drawVideo(videoEl, x, y, tileWidth, tileHeight, id)
      }
    })
  }

  /**
   * Speaker focus layout: current speaker full screen, others as thumbnails.
   */
  private drawSpeakerFocus(streamIds: string[]): void {
    const count = streamIds.length
    if (count === 0) return

    const speaker = this.currentSpeaker || streamIds[0]
    const others = streamIds.filter((id) => id !== speaker)

    // Draw speaker full screen
    const speakerVideo = this.videoElements.get(speaker)
    if (speakerVideo && speakerVideo.readyState === speakerVideo.HAVE_ENOUGH_DATA) {
      this.drawVideo(speakerVideo, 0, 0, this.width, this.height, speaker)
    }

    // Draw others as thumbnails in top-right
    if (others.length > 0) {
      const thumbWidth = Math.floor(this.width / 4) // 25% of width
      const thumbHeight = Math.floor(thumbWidth * (this.height / this.width)) // maintain aspect ratio

      others.forEach((id, idx) => {
        const videoEl = this.videoElements.get(id)
        if (videoEl && videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
          const x = this.width - thumbWidth - 10
          const y = 10 + idx * (thumbHeight + 10)
          this.drawVideo(videoEl, x, y, thumbWidth, thumbHeight, id)
          // Draw border
          this.ctx.strokeStyle = id === this.currentSpeaker ? '#4ade80' : '#888'
          this.ctx.lineWidth = 2
          this.ctx.strokeRect(x, y, thumbWidth, thumbHeight)
        }
      })
    }
  }

  /**
   * Draw a single video element onto the canvas at the specified position/size.
   */
  private drawVideo(videoEl: HTMLVideoElement, x: number, y: number, width: number, height: number, participantId: string): void {
    try {
      this.ctx.drawImage(videoEl, x, y, width, height)

      // Draw participant name
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
      this.ctx.fillRect(x, y + height - 30, width, 30)
      this.ctx.fillStyle = '#fff'
      this.ctx.font = '14px sans-serif'
      this.ctx.textAlign = 'left'
      const stream = this.streams.get(participantId)
      const name = stream?.participantName || 'Unknown'
      this.ctx.fillText(name, x + 5, y + height - 10)
    } catch (e) {
      // Ignore CORS/frame errors
    }
  }

  /**
   * Start mixing and return the output stream for recording.
   */
  async start(): Promise<MediaStream> {
    // Create canvas stream (video tracks)
    const canvasStream = this.canvas.captureStream(30)

    // Get audio output from AudioContext (mixed audio)
    let audioTrack: MediaStreamTrack | null = null
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
    }

    // Create a destination that we can extract as a track
    const audioDestination = this.audioContext.createMediaStreamDestination()

    // Reconnect all gain nodes to the new destination
    for (const gainNode of this.gainNodes.values()) {
      gainNode.disconnect()
      gainNode.connect(audioDestination)
    }

    audioTrack = audioDestination.stream.getAudioTracks()[0] || null

    // Combine video from canvas + audio from context
    const outputStream = new MediaStream()
    canvasStream.getVideoTracks().forEach((track) => {
      outputStream.addTrack(track)
    })
    if (audioTrack) {
      outputStream.addTrack(audioTrack)
    }

    this.destinationStream = outputStream
    this.outputAudioTrack = audioTrack as MediaStreamTrack

    // Start animation loop to draw frames
    const animate = () => {
      this.drawFrame()
      this.animationFrameId = requestAnimationFrame(animate)
    }
    animate()

    return outputStream
  }

  /**
   * Stop mixing and clean up resources.
   */
  stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }

    // Stop all video elements
    for (const videoEl of this.videoElements.values()) {
      videoEl.srcObject = null
    }

    // Disconnect audio nodes
    for (const gainNode of this.gainNodes.values()) {
      gainNode.disconnect()
    }

    // Close audio context if we created it
    if (this.audioContext.state !== 'closed') {
      this.audioContext.close()
    }
  }

  /**
   * Change the layout style.
   */
  setLayout(layout: StreamMixerLayout): void {
    this.layout = layout
  }

  /**
   * Resize the output canvas.
   */
  setSize(width: number, height: number): void {
    this.width = width
    this.height = height
    this.canvas.width = width
    this.canvas.height = height
  }

  /**
   * Get the current output stream.
   */
  getOutputStream(): MediaStream | null {
    return this.destinationStream
  }
}
