import { useEffect } from "react";
import { createPhaserGame } from "../phaser/main";

export default function GameCanvas() {
  useEffect(() => {
    const game = createPhaserGame("game-container");

    return () => {
      game.destroy(true);
    };
  }, []);

  return (
    <div
      id="game-container"
      style={{ width: "900px", height: "auto" }}
    />
  );
}
