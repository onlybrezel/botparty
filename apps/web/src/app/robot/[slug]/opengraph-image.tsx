import { ImageResponse } from 'next/og';
import type { RobotPublic } from '@botparty/shared';

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = 'image/png';

async function getRobot(slug: string): Promise<RobotPublic | null> {
  const apiUrl = process.env.API_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${apiUrl}/api/v1/robots/${slug}`, {
      next: { revalidate: 10 },
    });
    if (!res.ok) {
      return null;
    }
    return res.json() as Promise<RobotPublic>;
  } catch {
    return null;
  }
}

function trimDescription(value: string | null | undefined): string {
  const fallback = 'Watch and control this robot live on BotParty.';
  const text = value?.trim() || fallback;
  return text.length <= 180 ? text : `${text.slice(0, 177).trimEnd()}...`;
}

export default async function RobotOpenGraphImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const robot = await getRobot(slug);

  const name = robot?.name ?? 'Robot not found';
  const description = trimDescription(robot?.description);
  const owner = robot?.owner.displayName || robot?.owner.username || 'BotParty';
  const tags = robot?.tags.slice(0, 3) ?? [];
  const status = robot?.status ?? 'OFFLINE';
  const thumbnailUrl = robot?.thumbnailUrl ?? null;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          overflow: 'hidden',
          background:
            'radial-gradient(circle at top left, rgba(124,58,237,0.30), transparent 34%), radial-gradient(circle at bottom right, rgba(245,158,11,0.22), transparent 28%), linear-gradient(135deg, #09090b 0%, #10111b 58%, #15162a 100%)',
          color: '#f4f4f5',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 28,
            borderRadius: 32,
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
          }}
        />

        <div
          style={{
            display: 'flex',
            width: '100%',
            padding: '54px',
            gap: 40,
            zIndex: 1,
          }}
        >
          <div
            style={{
              display: 'flex',
              flex: 1,
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                fontSize: 28,
                color: '#c4b5fd',
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  background:
                    status === 'ONLINE'
                      ? '#22c55e'
                      : status === 'BUSY'
                        ? '#f59e0b'
                        : status === 'MAINTENANCE'
                          ? '#f59e0b'
                          : '#52525b',
                }}
              />
              {status} on BotParty
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                marginTop: 20,
                gap: 20,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  fontSize: 72,
                  fontWeight: 800,
                  lineHeight: 1.02,
                  letterSpacing: -2.5,
                  maxWidth: 650,
                }}
              >
                {name}
              </div>
              <div
                style={{
                  display: 'flex',
                  maxWidth: 640,
                  fontSize: 31,
                  lineHeight: 1.35,
                  color: '#d4d4d8',
                }}
              >
                {description}
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 18,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  fontSize: 24,
                  color: '#a1a1aa',
                }}
              >
                Hosted by {owner}
              </div>
              {tags.length > 0 ? (
                <div style={{ display: 'flex', gap: 12 }}>
                  {tags.map((tag) => (
                    <div
                      key={tag}
                      style={{
                        display: 'flex',
                        padding: '10px 18px',
                        borderRadius: 999,
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        fontSize: 22,
                        color: '#f4f4f5',
                      }}
                    >
                      #{tag}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              width: 370,
              minWidth: 370,
              borderRadius: 30,
              overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.08)',
              background: '#121320',
              justifyContent: 'center',
              alignItems: 'center',
              position: 'relative',
            }}
          >
            {thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbnailUrl}
                alt={`${name} preview`}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
            ) : (
              <div
                style={{
                  display: 'flex',
                  width: 180,
                  height: 180,
                  borderRadius: 40,
                  background: '#09090b',
                  justifyContent: 'center',
                  alignItems: 'center',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 8,
                    width: 30,
                    height: 30,
                    borderRadius: 999,
                    background: 'rgba(245,158,11,0.25)',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: 24,
                    width: 4,
                    height: 26,
                    borderRadius: 999,
                    background: '#7c3aed',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: 14,
                    width: 14,
                    height: 14,
                    borderRadius: 999,
                    background: '#f59e0b',
                  }}
                />
                <div
                  style={{
                    display: 'flex',
                    width: 108,
                    height: 82,
                    marginTop: 22,
                    borderRadius: 24,
                    background: '#7c3aed',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: -10,
                      top: 24,
                      width: 20,
                      height: 34,
                      borderRadius: 8,
                      background: '#5b21b6',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      right: -10,
                      top: 24,
                      width: 20,
                      height: 34,
                      borderRadius: 8,
                      background: '#5b21b6',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: 28,
                      top: 30,
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: '#09090b',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      right: 28,
                      top: 30,
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: '#09090b',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: 30,
                      top: 28,
                      width: 3,
                      height: 3,
                      borderRadius: 999,
                      background: 'rgba(255,255,255,0.9)',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      right: 30,
                      top: 28,
                      width: 3,
                      height: 3,
                      borderRadius: 999,
                      background: 'rgba(255,255,255,0.9)',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: 37,
                      bottom: 18,
                      width: 34,
                      height: 14,
                      borderBottom: '3px solid #09090b',
                      borderRadius: '0 0 999px 999px',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
