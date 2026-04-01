'use client';

import { LiveKitRoom, VideoTrack, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import type { TrackReference } from '@livekit/components-core';
import { Radio } from 'lucide-react';

function VideoRenderer() {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }]);
  // Filter out placeholder tracks (no publication)
  const robotTrack = tracks.find((t) => t.publication !== undefined) as TrackReference | undefined;

  if (!robotTrack) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--muted-foreground)]">
        <Radio className="h-8 w-8 text-violet-300/60" />
        <p className="text-sm">Waiting for robot video stream...</p>
      </div>
    );
  }

  return (
    <VideoTrack
      trackRef={robotTrack}
      className="h-full w-full object-cover"
    />
  );
}

interface Props {
  token: string;
  livekitUrl: string;
}

export function LiveKitPlayer({ token, livekitUrl }: Props) {
  return (
    <LiveKitRoom
      token={token}
      serverUrl={livekitUrl}
      video={false}
      audio={false}
      className="relative h-full w-full"
    >
      <VideoRenderer />
    </LiveKitRoom>
  );
}
