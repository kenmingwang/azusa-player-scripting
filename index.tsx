import { Navigation, Script } from "scripting";

import { DefaultPlaylistApp } from "./lib/defaultPlaylistApp";

async function run() {
  await Navigation.present({
    element: <DefaultPlaylistApp />,
  });

  Script.exit();
}

void run();
