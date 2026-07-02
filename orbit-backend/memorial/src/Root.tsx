import { Composition, staticFile } from "remotion";
import { Memorial } from "./Memorial";

// En producción el orbit-backend pasa name / date / photo / frase por inputProps
// y elige la composición según el formato:
//   "Memorial"         → 1080x1350 (feed 4:5)
//   "MemorialVertical" → 1080x1920 (Reels / Historias)
const DEFAULT_PROPS = {
  name: "Ginebra",
  date: "22 · 06 · 2026",
  photo: staticFile("img/pet.jpg"),
  frase: "Siempre en nuestro corazón",
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Memorial"
        component={Memorial}
        durationInFrames={360}
        fps={30}
        width={1080}
        height={1350}
        defaultProps={DEFAULT_PROPS}
      />
      <Composition
        id="MemorialVertical"
        component={Memorial}
        durationInFrames={360}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={DEFAULT_PROPS}
      />
    </>
  );
};
