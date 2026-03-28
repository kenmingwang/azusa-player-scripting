import { DefaultPlaylistApp } from "./defaultPlaylistApp";

type AzusaPoCAppProps = {
  initialInput?: string;
  autoImport?: boolean;
};

export function AzusaPoCApp(_props: AzusaPoCAppProps) {
  return <DefaultPlaylistApp />;
}
