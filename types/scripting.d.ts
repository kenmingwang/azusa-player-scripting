declare module "scripting" {
  export const AppEvents: any;
  export const AppIntentManager: any;
  export const AppIntentProtocol: any;
  export const BackgroundKeeper: any;
  export const ControlWidget: any;
  export const ControlWidgetButton: any;
  export const Data: any;
  export const DocumentPicker: any;
  export const Navigation: any;
  export const NavigationLink: any;
  export const NavigationStack: any;
  export const Script: any;
  export const Intent: any;
  export const IntentMemoryStorage: any;
  export const Safari: any;
  export const Button: any;
  export const Circle: any;
  export const Dialog: any;
  export const Image: any;
  export const List: any;
  export const ProgressView: any;
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
  export const ZStack: any;
  export const Spacer: any;
  export const Path: any;
  export const ScrollView: any;
  export const LazyVStack: any;
  export const ForEach: any;
  export const FileManager: any;
  export const Storage: any;
  export const BackgroundURLSession: any;
  export const UIImage: any;
  export const AVPlayer: any;
  export const SharedAudioSession: any;
  export const MediaPlayer: any;
  export const TimeControlStatus: any;
  export const useEffect: any;
  export const useMemo: any;
  export const useObservable: any;
  export const useState: any;
  export const Widget: any;

  export class Observable<T> {
    constructor(initialValue: T);
    value: T;
    setValue(value: T): void;
    subscribe(callback: (value: T, oldValue: T) => void): void;
    unsubscribe(callback: (value: T, oldValue: T) => void): void;
    dispose(): void;
  }
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
