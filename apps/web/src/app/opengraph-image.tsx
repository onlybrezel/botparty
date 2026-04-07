import { ImageResponse } from 'next/og';

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background:
            'radial-gradient(circle at top left, rgba(124,58,237,0.35), transparent 38%), radial-gradient(circle at bottom right, rgba(245,158,11,0.28), transparent 30%), linear-gradient(135deg, #09090b 0%, #11111a 55%, #141524 100%)',
          color: '#f4f4f5',
          fontFamily: 'sans-serif',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 32,
            borderRadius: 32,
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
          }}
        />

        <div
          style={{
            display: 'flex',
            width: '100%',
            padding: '72px',
            justifyContent: 'space-between',
            alignItems: 'center',
            zIndex: 1,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              maxWidth: 680,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                marginBottom: 30,
                fontSize: 28,
                color: '#c4b5fd',
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 999,
                  background: '#22c55e',
                  boxShadow: '0 0 28px rgba(34,197,94,0.6)',
                }}
              />
              Watch and drive real robots live
            </div>

            <div
              style={{
                display: 'flex',
                fontSize: 84,
                fontWeight: 800,
                lineHeight: 1,
                letterSpacing: -3,
              }}
            >
              BotParty
            </div>

            <div
              style={{
                display: 'flex',
                marginTop: 26,
                fontSize: 34,
                lineHeight: 1.35,
                color: '#d4d4d8',
              }}
            >
              Queue up, chat, and take control of internet-connected robots from your browser.
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              width: 260,
              height: 260,
              borderRadius: 56,
              background: '#09090b',
              border: '1px solid rgba(255,255,255,0.08)',
              justifyContent: 'center',
              alignItems: 'center',
              position: 'relative',
              boxShadow: '0 32px 80px rgba(0,0,0,0.45)',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 18,
                width: 34,
                height: 34,
                borderRadius: 999,
                background: 'rgba(245,158,11,0.25)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: 38,
                width: 4,
                height: 32,
                borderRadius: 999,
                background: '#7c3aed',
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: 28,
                width: 14,
                height: 14,
                borderRadius: 999,
                background: '#f59e0b',
              }}
            />
            <div
              style={{
                position: 'relative',
                display: 'flex',
                width: 148,
                height: 112,
                marginTop: 28,
                borderRadius: 30,
                background: '#7c3aed',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: -14,
                  top: 34,
                  width: 28,
                  height: 46,
                  borderRadius: 12,
                  background: '#5b21b6',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  right: -14,
                  top: 34,
                  width: 28,
                  height: 46,
                  borderRadius: 12,
                  background: '#5b21b6',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: 42,
                  top: 42,
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: '#09090b',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  right: 42,
                  top: 42,
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: '#09090b',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: 45,
                  top: 40,
                  width: 4,
                  height: 4,
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.9)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  right: 45,
                  top: 40,
                  width: 4,
                  height: 4,
                  borderRadius: 999,
                  background: 'rgba(255,255,255,0.9)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: 50,
                  bottom: 24,
                  width: 48,
                  height: 16,
                  borderBottom: '4px solid #09090b',
                  borderRadius: '0 0 999px 999px',
                }}
              />
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
