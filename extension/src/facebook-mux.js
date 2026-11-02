import { ALL_FORMATS, BlobSource, BufferTarget, EncodedAudioPacketSource, EncodedPacketSink, EncodedVideoPacketSource, Input, Mp4OutputFormat, Output } from "../vendor/mediabunny/index.mjs";

export async function muxFacebook(videoBlob, audioBlob) {
  const inputs = [videoBlob, audioBlob].filter(Boolean).map(blob => new Input({ source: new BlobSource(blob), formats: ALL_FORMATS }));
  try {
    const video = await inputs[0].getPrimaryVideoTrack();
    const audio = audioBlob ? await inputs[1].getPrimaryAudioTrack() : null;
    if (!video || (audioBlob && !audio)) throw new Error("Không đọc được luồng hình hoặc âm thanh của Facebook.");
    const videoCodec = await video.getCodec(), audioCodec = audio ? await audio.getCodec() : null;
    if (videoCodec !== "avc" || (audio && audioCodec !== "aac")) throw new Error("Định dạng luồng video Facebook này chưa được hỗ trợ.");
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat(), target });
    const videoSource = new EncodedVideoPacketSource(videoCodec);
    const audioSource = audio ? new EncodedAudioPacketSource(audioCodec) : null;
    output.addVideoTrack(videoSource);
    if (audioSource) output.addAudioTrack(audioSource);
    await output.start();
    async function copy(track, source) {
      const config = await track.getDecoderConfig();
      if (!config) throw new Error("Không đọc được thông số video Facebook.");
      let first = true;
      for await (const packet of new EncodedPacketSink(track).packets()) {
        await source.add(packet, first ? { decoderConfig: config } : undefined);
        first = false;
      }
      if (first) throw new Error("Luồng video Facebook không có dữ liệu.");
      source.close();
    }
    await Promise.all([copy(video, videoSource), ...(audio ? [copy(audio, audioSource)] : [])]);
    await output.finalize();
    return new Blob([target.buffer], { type: "video/mp4" });
  } finally { for (const input of inputs) input.dispose(); }
}
