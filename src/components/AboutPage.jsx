import { useState } from 'react';
import { T } from '../styles/theme';

const BORDER_SUBTLE = 'rgba(138,172,196,0.15)';
const BORDER_MEDIUM = 'rgba(138,172,196,0.35)';

function SocialPill({ href, label }) {
  const [hovered, setHovered] = useState(false);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-block',
        padding: '6px 14px',
        background: T.bgTertiary,
        border: `1px solid ${hovered ? BORDER_MEDIUM : BORDER_SUBTLE}`,
        borderRadius: 20,
        fontFamily: 'Raleway, sans-serif',
        fontSize: 11,
        color: hovered ? T.textPrimary : T.textSecondary,
        textDecoration: 'none',
        transition: 'border-color 0.15s, color 0.15s',
      }}
    >
      {label}
    </a>
  );
}

function DonationCard({ icon, label, handle, href, fullAddress }) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(fullAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const cardStyle = {
    background: hovered ? 'rgba(255,255,255,0.04)' : T.bgTertiary,
    border: `1px solid ${hovered ? BORDER_MEDIUM : BORDER_SUBTLE}`,
    borderRadius: 6,
    padding: 16,
    textAlign: 'center',
    transition: 'background 0.15s, border-color 0.15s',
    textDecoration: 'none',
    display: 'block',
  };

  const inner = (
    <>
      <div style={{ fontSize: 20, fontWeight: 700, color: T.gold, marginBottom: 6, fontFamily: 'Raleway, sans-serif' }}>
        {icon}
      </div>
      <div style={{ fontFamily: 'Raleway, sans-serif', fontSize: 12, fontWeight: 600, color: T.textPrimary, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'Raleway, sans-serif', fontSize: 10, color: T.textSecondary, wordBreak: 'break-all' }}>
        {handle}
      </div>
      {fullAddress && (
        <button
          onClick={handleCopy}
          style={{
            marginTop: 10,
            padding: '4px 10px',
            background: copied ? 'rgba(45,106,79,0.3)' : 'rgba(196,144,42,0.12)',
            border: `1px solid ${copied ? 'rgba(45,106,79,0.5)' : 'rgba(196,144,42,0.3)'}`,
            borderRadius: 4,
            fontFamily: 'Raleway, sans-serif',
            fontSize: 9,
            color: copied ? '#6fa37a' : T.gold,
            cursor: 'pointer',
            letterSpacing: 0.5,
            transition: 'all 0.15s',
          }}
        >
          {copied ? 'Copied ✓' : 'Copy address'}
        </button>
      )}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={cardStyle}
      >
        {inner}
      </a>
    );
  }
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={cardStyle}
    >
      {inner}
    </div>
  );
}

export default function AboutPage() {
  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      background: T.bgPrimary,
    }}>
      <div style={{
        maxWidth: 680,
        margin: '0 auto',
        padding: '60px 24px 0',
      }}>

        {/* Hero quote */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <p style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 36,
            fontStyle: 'italic',
            color: T.textPrimary,
            margin: 0,
            lineHeight: 1.3,
          }}>
            "The masculine urge to study maps."
          </p>
          <div style={{
            width: 40,
            height: 2,
            background: T.gold,
            margin: '20px auto 0',
          }} />
        </div>

        {/* Photo grid */}
        <div style={{ marginBottom: 48 }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <img
              src="/about/canyon.jpg"
              alt="Canyonlands"
              style={{ flex: 1, minWidth: 0, height: 280, objectFit: 'cover', borderRadius: 4, display: 'block' }}
            />
            <img
              src="/about/alpine.jpg"
              alt="Alpine lake"
              style={{ flex: 1, minWidth: 0, height: 280, objectFit: 'cover', borderRadius: 4, display: 'block' }}
            />
          </div>
          <img
            src="/about/hawaii.jpg"
            alt="Hawaii"
            style={{ width: '100%', height: 480, objectFit: 'cover', objectPosition: 'center top', borderRadius: 4, display: 'block' }}
          />
        </div>

        {/* Bio */}
        <div style={{ marginBottom: 40 }}>
          <p style={{
            fontFamily: 'Raleway, sans-serif',
            fontSize: 15,
            color: T.textSecondary,
            lineHeight: 1.8,
            margin: 0,
          }}>
            Just a dude who gets unreasonably excited about county lines, river confluences, and the fact that Kentucky extends further west than Tennessee. Whereabouts started as a side project to scratch my own itch: I wanted a geography quiz that actually went deep. No multiple choice for capitals only. Real drag-and-drop maps. All 50 states. Every county, river, peak, and national park I could get the data for.
          </p>
          <p style={{
            fontFamily: 'Raleway, sans-serif',
            fontSize: 15,
            color: T.textSecondary,
            lineHeight: 1.8,
            marginTop: 16,
            marginBottom: 0,
          }}>
            If you find a bug, a missing river, a mislabeled peak, or just want to suggest a feature — reach out. I built this alone and I'm always iterating.
          </p>
        </div>

        {/* Social */}
        <div style={{ marginBottom: 48 }}>
          <span style={{
            fontFamily: 'Raleway, sans-serif',
            fontSize: 11,
            color: T.textMuted,
            marginRight: 12,
          }}>
            Find me on
          </span>
          <SocialPill href="https://instagram.com/troxofthetrade" label="@troxofthetrade on Instagram" />
          {' '}
          <SocialPill href="https://x.com/troxofthetrade" label="@troxofthetrade on X" />
        </div>

        {/* Support */}
        <div style={{ marginBottom: 0 }}>
          <div style={{
            fontFamily: 'Raleway, sans-serif',
            fontSize: 11,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: T.textMuted,
            marginBottom: 16,
          }}>
            Support the project
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <DonationCard
              icon="$"
              label="Venmo"
              handle="@TroxOfTheTrade"
              href="https://account.venmo.com/u/TroxOfTheTrade"
            />
            <DonationCard
              icon="P"
              label="PayPal"
              handle="paypal.me/troxofthetrade"
              href="https://paypal.me/troxofthetrade"
            />
            <DonationCard
              icon="◈"
              label="XRP"
              handle="rw2ciy...nWKQg"
              fullAddress="rw2ciyaNshpHe7bCHo4bRWq6pqqynnWKQg"
            />
            <DonationCard
              icon="₿"
              label="Bitcoin"
              handle="3Mh1Xr...oQ8b"
              fullAddress="3Mh1XrUgJJ48dWjdvtjbQvRv3sTyeMoQ8b"
            />
          </div>
        </div>

        {/* Page footer */}
        <div style={{
          fontFamily: 'Raleway, sans-serif',
          fontSize: 10,
          color: T.textMuted,
          textAlign: 'center',
          marginTop: 60,
          paddingBottom: 60,
        }}>
          Built with React + D3 · Data from USGS, NPS, OpenStreetMap
        </div>

      </div>
    </div>
  );
}
