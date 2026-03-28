declare module "scripting" {
  export const AppIntentManager: any;
  export const AppIntentProtocol: any;
  export const ControlWidget: any;
  export const ControlWidgetButton: any;
  export const Navigation: any;
  export const NavigationStack: any;
  export const Script: any;
  export const Intent: any;
  export const Safari: any;
  export const Button: any;
  export const Circle: any;
  export const Dialog: any;
  export const Image: any;
  export const List: any;
  export const Text: any;
  export const TextField: any;
  export const Form: any;
  export const Section: any;
  export const HStack: any;
  export const LiveActivity: any;
  export const LiveActivityUI: any;
  export const LiveActivityUIExpandedBottom: any;
  export const LiveActivityUIExpandedCenter: any;
  export const VStack: any;
  export const Spacer: any;
  export const Path: any;
  export const FileManager: any;
  export const Storage: any;
  export const BackgroundURLSession: any;
  export const AVPlayer: any;
  export const SharedAudioSession: any;
  export const MediaPlayer: any;
  export const TimeControlStatus: any;
  export const useEffect: any;
  export const useMemo: any;
  export const useState: any;
  export const Widget: any;
}

declare function setInterval(
  handler: (...args: any[]) => void,
  timeout?: number,
  ...args: any[]
): number;

declare function clearInterval(handle?: number): void;

declare namespace JSX {
  interface Element {}
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}
