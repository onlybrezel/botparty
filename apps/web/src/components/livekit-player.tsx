'use client';

import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import { useState } from 'react';
import { VideoRenderer } from './livekit/video-renderer';
import { readVolumePreference, type StreamConfig } from './livekit/stats-utils';

interface Props {
  token: string;
  livekitUrl: string;
  onStreamStalled?: () => void;
  streamConfig?: StreamConfig;
  volumeStorageKey?: string;
}

export function LiveKitPlayer({ token, livekitUrl, onStreamStalled, streamConfig, volumeStorageKey }: Props) {
  const [volume, setVolume] = useState(() => readVolumePreference(volumeStorageKey).volume);
  const [isMuted, setIsMuted] = useState(() => readVolumePreference(volumeStorageKey).isMuted);
  return (
    <LiveKitRoom
      token={token}
      serverUrl={livekitUrl}
      options={{ adaptiveStream: false, dynacast: false }}
      video={false}
      audio={false}
      className="relative h-full w-full"
    >
      {/* Render remote participant audio tracks into hidden audio elements. */}
      <RoomAudioRenderer volume={isMuted ? 0 : volume / 100} muted={isMuted} />
      <VideoRenderer
        onStreamStalled={onStreamStalled}
        streamConfig={streamConfig}
        volumeStorageKey={volumeStorageKey}
        volume={volume}
        isMuted={isMuted}
        onVolumeChange={setVolume}
        onMutedChange={setIsMuted}
      />
    </LiveKitRoom>
  );
}

