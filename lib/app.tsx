import { DefaultPlaylistApp } from "./defaultPlaylistApp";

type AzusaPoCAppProps = {
  initialInput?: string;
  autoImport?: boolean;
};

export function AzusaPoCApp(props: AzusaPoCAppProps) {
  return <DefaultPlaylistApp initialInput={props.initialInput} />;
}
