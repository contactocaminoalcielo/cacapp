import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Easing,
  interpolate,
  random,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  continueRender,
  delayRender,
} from "remotion";

/* ------------------------------------------------------------------ */
/* Paleta de marca Camino al Cielo                                     */
/* ------------------------------------------------------------------ */
const DEEP = "#22331f";
const GREEN = "#3D5A27";
const GOLD = "#C4A87A";
const GOLD_SOFT = "#D8C39B";
const CREAM = "#F5F1E8";

/* ------------------------------------------------------------------ */
/* Carga de tipografías premium (variable + estáticas)                 */
/* ------------------------------------------------------------------ */
const FONTS = [
  { family: "PlayfairV", file: "fonts/Playfair.ttf", weight: "400 900" },
  { family: "NunitoV", file: "fonts/Nunito.ttf", weight: "400 900" },
  { family: "Cormorant", file: "fonts/Cormorant-SemiBold.ttf", weight: "600" },
  { family: "CormorantR", file: "fonts/Cormorant-Regular.ttf", weight: "400" },
];

const useFonts = () => {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    Promise.all(
      FONTS.map((f) => {
        const ff = new FontFace(f.family, `url(${staticFile(f.file)})`, {
          weight: f.weight,
        });
        // @ts-ignore
        document.fonts.add(ff);
        return ff.load();
      })
    )
      .then(() => continueRender(handle))
      .catch(() => continueRender(handle));
  }, [handle]);
};

/* ------------------------------------------------------------------ */
/* Helpers de animación                                                */
/* ------------------------------------------------------------------ */
const fadeUp = (frame: number, start: number, dur: number, dy = 34) => {
  const p = interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return { opacity: p, transform: `translateY(${(1 - p) * dy}px)` };
};

/* ------------------------------------------------------------------ */
/* Partículas doradas flotando hacia arriba                            */
/* ------------------------------------------------------------------ */
const Particles: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const N = 26;
  return (
    <AbsoluteFill>
      {new Array(N).fill(0).map((_, i) => {
        const seed = i * 3.17;
        const x = random(`x${seed}`) * width;
        const size = 3 + random(`s${seed}`) * 9;
        const speed = 0.25 + random(`v${seed}`) * 0.6;
        const drift = (random(`d${seed}`) - 0.5) * 90;
        const phase = random(`p${seed}`) * durationInFrames;
        const y =
          height + 40 - ((frame * speed + phase) % (height + 120));
        const tw =
          0.35 +
          0.4 *
            (0.5 + 0.5 * Math.sin((frame + phase) * 0.06 + i));
        const sway = Math.sin((frame + phase) * 0.03) * drift;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x + sway,
              top: y,
              width: size,
              height: size,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${GOLD_SOFT} 0%, rgba(196,168,122,0) 70%)`,
              opacity: tw,
              filter: "blur(0.4px)",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* Estrellas / destellos de 4 puntas                                   */
/* ------------------------------------------------------------------ */
const Sparkle: React.FC<{ x: number; y: number; delay: number; s?: number }> = ({
  x,
  y,
  delay,
  s = 26,
}) => {
  const frame = useCurrentFrame();
  const appear = interpolate(frame, [delay, delay + 18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const tw = 0.5 + 0.5 * Math.sin((frame - delay) * 0.09);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        opacity: appear * (0.55 + 0.45 * tw),
        transform: `translate(-50%,-50%) scale(${0.7 + tw * 0.5}) rotate(${
          (frame - delay) * 0.4
        }deg)`,
      }}
    >
      <svg width={s} height={s} viewBox="0 0 100 100">
        <path
          d="M50 2 C54 38 62 46 98 50 C62 54 54 62 50 98 C46 62 38 54 2 50 C38 46 46 38 50 2 Z"
          fill={GOLD}
        />
      </svg>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Composición principal                                               */
/* ------------------------------------------------------------------ */
export const Memorial: React.FC<{
  name: string;
  date: string;
  photo: string;
  frase?: string;
  // Encuadre de la foto (elegido en ORBIT): zoom 1-3, posX/posY 0-100 (%).
  zoom?: number;
  posX?: number;
  posY?: number;
}> = ({ name, date, photo, frase = "Siempre en nuestro corazón", zoom = 1, posX = 50, posY = 50 }) => {
  useFonts();
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  /* Entrada global */
  const globalIn = interpolate(frame, [0, 18], [0, 1], {
    extrapolateRight: "clamp",
  });

  /* Logo */
  const logo = fadeUp(frame, 12, 26, 22);

  /* Foto: aparición con spring + Ken Burns */
  const photoSpring = spring({
    frame: frame - 26,
    fps,
    config: { damping: 200, mass: 0.9 },
  });
  const photoScale = interpolate(photoSpring, [0, 1], [0.9, 1]);
  const photoOpacity = interpolate(frame, [26, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const kb = interpolate(frame, [26, 360], [1.06, 1.16]); // zoom lento
  const kbY = interpolate(frame, [26, 360], [0, -14]);

  /* Textos */
  const eyebrow = fadeUp(frame, 88, 24, 16);
  const nameA = fadeUp(frame, 104, 30, 30);
  const nameLS = interpolate(frame, [104, 150], [22, 8], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const dividerW = interpolate(frame, [140, 168], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const dateA = fadeUp(frame, 158, 26, 18);
  const phraseA = fadeUp(frame, 178, 28, 16);

  /* halo pulse suave detrás de la foto */
  const halo = 0.22 + 0.06 * Math.sin(frame * 0.05);

  const PHOTO_W = 582;
  const PHOTO_H = 652;
  const ARCH = "290px 290px 42px 42px";

  // Layout adaptable: el diseño se compuso a 1350 de alto. En formatos más altos
  // (1080x1920 = Reels/Historias) centramos el bloque de contenido verticalmente,
  // dejando el fondo/partículas a pantalla completa.
  const DESIGN_H = 1350;
  const offsetY = Math.max(0, (height - DESIGN_H) / 2);
  const glowPct = ((offsetY + 540) / height) * 100;

  return (
    <AbsoluteFill style={{ opacity: globalIn }}>
      {/* Melodía original (piano cálido, libre de derechos) */}
      <Audio src={staticFile("audio/memorial.mp3")} volume={0.9} />

      {/* Fondo degradado salvia */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(165deg,#EEF1E9 0%,#E0E6D8 42%,#CBD5C1 100%)",
        }}
      />
      {/* Glow cálido detrás de la foto */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(58% 42% at 50% ${glowPct}%, rgba(196,168,122,${halo}), rgba(196,168,122,0) 70%)`,
        }}
      />

      <Particles />

      {/* Viñeta suave */}
      <AbsoluteFill
        style={{
          boxShadow: "inset 0 0 320px rgba(34,51,31,0.30)",
          pointerEvents: "none",
        }}
      />

      {/* Destellos decorativos */}
      <Sparkle x={width * 0.16} y={height * 0.30} delay={60} s={30} />
      <Sparkle x={width * 0.85} y={height * 0.24} delay={78} s={22} />
      <Sparkle x={width * 0.82} y={height * 0.63} delay={96} s={28} />
      <Sparkle x={width * 0.14} y={height * 0.60} delay={112} s={20} />

      {/* Logo */}
      <div
        style={{
          position: "absolute",
          top: 58 + offsetY,
          left: 0,
          width,
          display: "flex",
          justifyContent: "center",
          ...logo,
        }}
      >
        <Img
          src={staticFile("img/logo.png")}
          style={{
            width: 268,
            filter: "drop-shadow(0 4px 10px rgba(34,51,31,0.18))",
          }}
        />
      </div>

      {/* Foto en arco (portal) */}
      <div
        style={{
          position: "absolute",
          top: 296 + offsetY,
          left: (width - PHOTO_W) / 2,
          width: PHOTO_W,
          height: PHOTO_H,
          opacity: photoOpacity,
          transform: `scale(${photoScale})`,
          transformOrigin: "50% 60%",
        }}
      >
        {/* Marco dorado */}
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: ARCH,
            padding: 7,
            background: `linear-gradient(160deg, ${GOLD_SOFT}, ${GOLD} 55%, #A98B58)`,
            boxShadow:
              "0 26px 60px rgba(34,51,31,0.34), 0 4px 14px rgba(34,51,31,0.20)",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              borderRadius: ARCH,
              overflow: "hidden",
              position: "relative",
              background: DEEP,
            }}
          >
            <Img
              src={photo}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: `${posX}% ${posY}%`,
                transform: `scale(${kb * zoom}) translateY(${kbY}px)`,
                transformOrigin: `${posX}% ${posY}%`,
              }}
            />
            {/* Viñeta interna sutil */}
            <AbsoluteFill
              style={{
                boxShadow: "inset 0 0 120px rgba(34,51,31,0.45)",
                borderRadius: ARCH,
              }}
            />
            {/* Brillo superior */}
            <AbsoluteFill
              style={{
                background:
                  "linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 30%)",
                borderRadius: ARCH,
              }}
            />
          </div>
        </div>
      </div>

      {/* Bloque de texto */}
      <div
        style={{
          position: "absolute",
          top: 990 + offsetY,
          left: 0,
          width,
          textAlign: "center",
        }}
      >
        {/* Eyebrow */}
        <div
          style={{
            fontFamily: "Cormorant, serif",
            fontWeight: 600,
            fontSize: 25,
            letterSpacing: 9,
            color: GREEN,
            textTransform: "uppercase",
            ...eyebrow,
          }}
        >
          En memoria de
        </div>

        {/* Nombre */}
        <div
          style={{
            fontFamily: "PlayfairV, serif",
            fontWeight: 700,
            fontSize: 96,
            lineHeight: 1.02,
            color: DEEP,
            textTransform: "uppercase",
            letterSpacing: nameLS,
            marginTop: 8,
            textShadow: "0 2px 10px rgba(34,51,31,0.12)",
            ...nameA,
          }}
        >
          {name}
        </div>

        {/* Divisor dorado con diamante */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            marginTop: 18,
          }}
        >
          <div
            style={{
              height: 2,
              width: 150 * dividerW,
              background: `linear-gradient(90deg, rgba(196,168,122,0), ${GOLD})`,
            }}
          />
          <div
            style={{
              width: 10,
              height: 10,
              transform: `rotate(45deg) scale(${dividerW})`,
              background: GOLD,
            }}
          />
          <div
            style={{
              height: 2,
              width: 150 * dividerW,
              background: `linear-gradient(90deg, ${GOLD}, rgba(196,168,122,0))`,
            }}
          />
        </div>

        {/* Fecha */}
        <div
          style={{
            fontFamily: "Cormorant, serif",
            fontWeight: 600,
            fontSize: 42,
            letterSpacing: 4,
            color: GREEN,
            marginTop: 14,
            ...dateA,
          }}
        >
          {date}
        </div>

        {/* Frase */}
        <div
          style={{
            fontFamily: "CormorantR, serif",
            fontStyle: "italic",
            fontSize: 30,
            color: "#5a6b4d",
            marginTop: 6,
            ...phraseA,
          }}
        >
          {frase} 🐾
        </div>
      </div>

      {/* Grano/textura muy sutil */}
      <AbsoluteFill
        style={{
          opacity: 0.04,
          mixBlendMode: "overlay",
          backgroundImage:
            "radial-gradient(rgba(0,0,0,0.6) 1px, transparent 1px)",
          backgroundSize: "3px 3px",
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
