import { Intent, Navigation, Script } from "scripting";

import { DefaultPlaylistApp } from "./lib/defaultPlaylistApp";

function shouldRequestForeground() {
  return Boolean(Intent.shortcutParameter);
}

function resolveIntentInput() {
  return (
    Intent.urlsParameter?.[0] ??
    Intent.textsParameter?.[0] ??
    (Intent.shortcutParameter?.type === "text"
      ? Intent.shortcutParameter.value
      : undefined)
  );
}

async function run() {
  const initialInput = resolveIntentInput();
  const continueInForeground = (Intent as any).continueInForeground;

  if (
    shouldRequestForeground() &&
    typeof continueInForeground === "function"
  ) {
    await continueInForeground(
      {
        full: "继续在 Scripting 中打开 Azusa？",
        supporting: "这一步需要完整播放器界面来浏览歌单和控制播放。",
        systemImageName: "music.note.list",
      },
      { alwaysConfirm: false },
    );
  }

  await Navigation.present({
    element: <DefaultPlaylistApp initialInput={initialInput} />,
  });

  Script.exit();
}

void run();
