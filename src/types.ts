export interface Message {
  role: "user" | "assistant" | "system";
  text: string;
  ts: number;
}

export interface ForecastItem {
  dt: number;
  dt_txt: string;
  main: {
    temp: number;
    feels_like: number;
    temp_min: number;
    temp_max: number;
    humidity: number;
  };
  weather: Array<{
    main: string;
    description: string;
  }>;
  wind: {
    speed: number;
  };
  pop: number;
}

export interface ForecastData {
  list: ForecastItem[];
  city: {
    name: string;
    country: string;
  };
}

export interface LLMResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export enum QueryType {
  WEATHER = 'weather',
  ITINERARY = 'itinerary',
  PACKING = 'packing',
  VISA = 'visa',
  EVENTS = 'events',
  COMPARISON = 'comparison',
  GENERAL = 'general'
}