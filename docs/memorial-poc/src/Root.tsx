import { Composition } from "remotion";
import { Memorial } from "./Memorial";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Memorial"
      component={Memorial}
      durationInFrames={360}
      fps={30}
      width={1080}
      height={1350}
      defaultProps={{
        name: "Ginebra",
        date: "22 · 06 · 2026",
        photo: "img/pet.jpg",
      }}
    />
  );
};
