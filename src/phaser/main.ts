import Phaser from "phaser";
import GameScene from "./scenes/GameScene";

export function createPhaserGame(parentId: string) {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: 900,
    height: 505,
    parent: parentId,
    scene: [GameScene],
    physics: {
      default: "arcade",
      arcade: { debug: false },
    },
  };

  return new Phaser.Game(config);
}
