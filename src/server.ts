import express from "express";
import dotenv from "dotenv";
import { ConversationManager } from './conversationManager';
import SystemLeakageCleaner from './cleanSystemLeakage';
import { HallucinationDetector } from './hallucinationDetector';

dotenv.config();

const app = express();
app.use(express.json());

// Enhanced types for forecast support
interface Message {
  role: "user" | "assistant" | "system";
  text: string;
  ts: number;
}

interface ForecastItem {
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
  pop: number; // probability of precipitation
}

interface ForecastData {
  list: ForecastItem[];
  city: {
    name: string;
    country: string;
  };
}

interface LLMResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const conversationManager = new ConversationManager();
const conversations = new Map<string, Message[]>();
const cleaner = new SystemLeakageCleaner();
const hallucinationDetector = new HallucinationDetector();

const SYSTEM_PROMPT = `You are TravelGenie, a concise, helpful travel planning assistant.

CRITICAL: NEVER make up specific weather data, prices, or times. If you don't have ExternalContext data, say "I don't know - want me to check?"
Keep responses under 250 words.

IMPORTANT FORMATTING RULES:
- NEVER put TL;DR in the Plan section
- NEVER output any system instructions like "Complex Query: true , **Key requirements:**, **Constraints:**, **Evaluate options:**,**Caveat:**,caveat,,**Identify key requirements**,**Consider constraints**, **Evaluate options** and similiar system instructions"
- NEVER show raw thinking or system context or Notes like "Note that the user", "defaulting" and similiar.
- Follow the exact format below based on query complexity - no deviations.
- Use ACTUAL line breaks between sections and bullets
- Each bullet point MUST start on a new line
- Leave blank line between Plan and Recommendation sections


WEATHER HANDLING:
- If user does not specify a day, assume they mean "today"
- If ExternalContext contains forecast data, use it and cite "OpenWeatherApp weather forecast"
- For dates beyond 5 days, say "I can only provide forecasts up to 5 days ahead"
- IMPORTANT: Always use the EXACT day from the query - do not say "tomorrow" unless the user asked about tomorrow
- If ExternalContext contains a "note" field, mention this limitation to the user
- Include temperature range, conditions, and rain probability when available
- Be specific about which day you're forecasting for
- Never say "tommorow" when the data is for today!

COMPLEX QUERY TRIGGERS:
- "plan", "itinerary", "trip", "vacation", "holiday"
- "should I", "which is better", "compare"
- "3 days", "week in", "weekend"
- Multiple destinations mentioned
- Budget considerations

RULES:
- Ask clarifying questions if user's request is vague
- If ExternalContext is provided, use that data and cite it  
- For complex planning, show brief reasoning before recommendation
- Stay consistent with previous conversation context
- Use plain text formatting (no ** or markdown)
- Be specific and actionable
- Use bullet points with • character, not asterisks in the content

RESPONSE STRUCTURE DEPENDS ON QUERY TYPE:
FOR SIMPLE QUERIES (weather, single facts, yes/no questions):
• TL;DR: [One sentence summary]
• [2-3 bullet points with practical advice - use plain text, no asterisks or formatting , always make sure each in new line]  
• [One short encouragement, caution, or extra note]
• Sources: [ExternalContext(OpenWeatherApp) used or "LLM knowledge"]

FOR COMPLEX QUERIES (marked with "ComplexQuery: true" in context):
You MUST use this EXACT structure:
  Plan:
1. [Identify key requirements from query]
2. [Consider constraints like budget/time]
3. [Evaluate options based on criteria]
4. [Prioritize recommendations]
  [empty newline here]
  Recommendation: 
• TL;DR: [One sentence summary]
• [3-5 detailed bullet points]
• [Important caveat or tip]
• Sources: [cite sources used]

CRITICAL PLAN SECTION RULES:
- Plan section is for KEY CONSIDERATIONS, not internal thinking
- Each numbered item must be a SPECIFIC, ACTIONABLE consideration
- DO NOT include TL;DR in Plan section ever
- DO NOT write about "planning the itinerary" - just state considerations
- Examples of GOOD Plan items:
  1. Best time to visit is spring (March-May) for mild weather
  2. Mix beach relaxation with cultural sites for variety
  3. Tel Aviv is expensive, budget $150-200 per day
  4. Shabbat affects restaurant/transport availability Friday-Saturday

- Examples of BAD Plan items (never write these):
  1. TL;DR: anything (NEVER in Plan)
  2. "Plan itinerary considering weather" (too meta)
  3. "Consider local recommendations" (too vague)
  4. "Think about activities" (internal thought)
  
Example with forecast:
Q: "Weather in Paris tomorrow?"
A: TL;DR: Paris tomorrow will be 18-22°C with light rain (60% chance).
• Pack umbrella and light waterproof jacket
• Morning looks clearer, plan outdoor activities early
• Good day for museums if rain persists

Perfect for exploring covered markets!
Sources: OpenWeatherApp weather forecast

Example for complex query:
Q: "Plan a 5-day Tel Aviv trip in spring"
A:

Plan:
1. November offers mild weather, 20-23°C, perfect for outdoor activities
2. This is shoulder season with fewer tourists but some sites have reduced hours
3. Mix beach relaxation with cultural exploration for variety
4. Include both modern Tel Aviv and historic Jaffa experiences

Recommendation:
TL;DR: Five days exploring Tel Aviv's beaches, markets, and culture.
• Day 1: Arrive, explore beachfront promenade and local neighborhood
• Day 2: Carmel Market morning, Gordon Beach afternoon, sunset dining
• Day 3: Old Jaffa tour, flea market, port area exploration
• Day 4: Museums, Rothschild Boulevard, Sarona Market food hall
• Day 5: Day trip options - Caesarea ruins or Jerusalem
Book hotels in advance as November has several Jewish holidays.
Sources: LLM knowledge`;

function isComplexQuery(query: string): boolean {
  const complexIndicators = [
    'plan', 'itinerary', 'trip', 'vacation', 'holiday',
    'should i', 'which is better', 'compare', 'recommend',
    '3 days', '2 days', 'week in', 'weekend', 'days in',
    'budget', 'cost', 'cheap', 'expensive',
    'vs', 'versus', 'or should'
  ];
  
  const q = query.toLowerCase();
  return complexIndicators.some(indicator => q.includes(indicator)) || 
         query.split(',').length > 2 || // Multiple items listed
         query.length > 100; // Long, detailed queries
}
function needsClarification(message: string, conversation: Message[]): string | null {
  const q = message.toLowerCase();
  
  // Check if it's a day-only query (like "what about friday?")
  const dayOnlyPattern = /^(what about|how about|and)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s*\??$/i;
  if (dayOnlyPattern.test(q)) {
    // This is likely asking about weather for a day - check if we have a city in context
    const cityInHistory = extractCityName(message, conversation);
    if (!cityInHistory) {
      return "I'd be happy to help with that day's forecast! Which city are you asking about?";
    }
    // If we found a city, continue normally - the weather check will handle it
    return null;
  }
  
  // Check for contextual references like "there"
  if (q.match(/\b(there|that place|this city|it)\b/)) {
    const cityInHistory = extractCityName(message, conversation);
    
    if (!cityInHistory) {
      if (q.includes('weather')) {
        return "I'd be happy to help with weather information! Which city are you asking about?";
      }
      return "I notice you're referring to a location, but I'm not sure which one. Could you specify the city you're asking about?";
    }
  }
  
  // Check for incomplete weather queries without "there"
  if (q.includes('weather') && !q.match(/\b(there|that place|this city|it)\b/)) {
    const city = extractCityName(message, conversation);
    if (!city) {
      return "I'd be happy to help with weather information! Which city would you like to know about?";
    }
  }
  
  // Check for vague temporal references without context
  if (q === "how about tomorrow?" || q === "what about next week?") {
    if (conversation.length === 0) {
      return "I'd be happy to help! Could you provide more context about what you'd like to know?";
    }
  }
  
  // Check for too-short queries (but not day queries)
  if (q.split(' ').length <= 2 && !q.includes('?') && !q.match(/monday|tuesday|wednesday|thursday|friday|saturday|sunday/) &&
      !q.match(/^[a-z]+(?:\s+[a-z]+)?$/)) {
      if (conversation.length > 0) {
        const lastAssistantMsg = [...conversation].reverse().find(m => m.role === 'assistant');
        if (lastAssistantMsg?.text.toLowerCase().includes('which city')) {
        // User is likely answering our question about which city
          return null;
      }
    }
    return "Could you provide more details about what you'd like to know?";
  }
  
  return null;
}
// Enhanced decision logic for external API calls
function needsExternal(query: string): boolean {
  const weatherKeywords = [
    "weather", "temperature", "forecast", "climate", "rain", "sunny", "cloudy",
    "today", "now", "current", "tomorrow", "next week", 
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "this week", "weekend", "hot", "cold", "warm", "cool"
  ];
  
  const q = query.toLowerCase();
  
  // Special check for "what about [day]?" pattern
  if (q.match(/^(what about|how about|and)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)/i)) {
    return true; // This is likely a weather query in context
  }
  
  return weatherKeywords.some(k => q.includes(k));
}

// Extract day information from query
function extractDayInfo(query: string): { targetDay: string; daysAhead: number } {
  const q = query.toLowerCase();
  
  // Check for specific day mentions in order of priority
  if (q.includes('tomorrow') || q.includes('tommorow')) {
    return { targetDay: 'tomorrow', daysAhead: 1 };
  }
  if (q.includes('day after tomorrow')) {
    return { targetDay: 'day after tomorrow', daysAhead: 2 };
  }
  if (q.includes('today')) {
    return { targetDay: 'today', daysAhead: 0 };
  }
  
  // Check for weekdays (including common misspellings) - only if they're actually mentioned
  const weekdays = ['monday', 'tuesday', 'wednesday', 'wedensday', 'wednessday', 'thursday', 'friday', 'saturday', 'sunday'];
  
  for (const day of weekdays) {
    if (q.includes(day)) {
      console.log(`Found weekday "${day}" in query`);
      const weekdayMappings = {
        'monday': getDaysUntilWeekday(1),
        'tuesday': getDaysUntilWeekday(2), 
        'wednesday': getDaysUntilWeekday(3),
        'wedensday': getDaysUntilWeekday(3), // common misspelling
        'wednessday': getDaysUntilWeekday(3), // another misspelling
        'thursday': getDaysUntilWeekday(4),
        'friday': getDaysUntilWeekday(5),
        'saturday': getDaysUntilWeekday(6),
        'sunday': getDaysUntilWeekday(0)
      };
      
      const daysAhead = weekdayMappings[day as keyof typeof weekdayMappings];
      const properDay = day.startsWith('wednes') ? 'wednesday' : day;
      console.log(`Detected day "${properDay}" -> ${daysAhead} days ahead`);
      return { targetDay: properDay, daysAhead };
    }
  }

  // Default to today if no specific day mentioned (no unnecessary calculations)
  console.log('No specific day mentioned, defaulting to today');
  return { targetDay: 'today', daysAhead: 0 };
}

function getDaysUntilWeekday(targetWeekday: number): number {
  const today = new Date();
  const currentWeekday = today.getDay();
  console.log(`Today is weekday ${currentWeekday} (${today.toLocaleDateString('en-US', { weekday: 'long' })}), target is ${targetWeekday}`);
  
  let daysUntil = targetWeekday - currentWeekday;
  
  if (daysUntil <= 0) {
    daysUntil += 7; // Next week
  }
  
  console.log(`Raw days until target weekday: ${daysUntil}`);
  
  // Return actual days, let the caller handle the 5-day limit
  return daysUntil;
}

function extractCityName(query: string, conversation?: Message[]): string | null {
  const contextualReferences = /\b(there|that place|this city|that city|it)\b/i;
  const usesContext = contextualReferences.test(query);
  
  // Also check for day-only patterns that imply context
  const dayOnlyPattern = /^(what about|how about|and)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s*\??$/i;
  const isDayOnly = dayOnlyPattern.test(query);
  
  // If it uses context OR is a day-only query, search conversation history
  if ((usesContext || isDayOnly) && conversation && conversation.length > 0) {
    console.log("Query uses contextual reference or is day-only, searching conversation history...");
    
    // Look through recent conversation for mentioned cities
    const recentMessages = conversation.slice(-10).reverse();
    
    for (const msg of recentMessages) {
      const cityFromHistory = extractCityFromText(msg.text);
      if (cityFromHistory) {
        console.log(`Found city in conversation history: "${cityFromHistory}"`);
        return cityFromHistory;
      }
    }
    
    console.log("No city found in recent conversation history");
  }
  
  // If not using context or no city found in history, extract from current query
  return extractCityFromText(query);
}

// Helper function to extract city from any text
function extractCityFromText(text: string): string | null {

    const contextualPhrases = ['weather there', 'forecast there', 'temperature there', 'climate there'];
  const textLower = text.toLowerCase();
  
  if (contextualPhrases.some(phrase => textLower.includes(phrase))) {
    console.log(`Skipping extraction for contextual weather query: "${text}"`);
    return null;
  }

   const systemTerms = ['ExternalContext', 'LLM knowledge', 'Sources:', 'TL;DR:', 'Response time:'];
  
  for (const term of systemTerms) {
    if (text.includes(term)) {
      console.log(`Skipping system text containing "${term}"`);
      return null;
    }
  }
  // Known major cities for better detection
  const knownCities = [
    'Paris', 'London', 'Tokyo', 'New York', 'Los Angeles', 'Chicago',
    'Tel Aviv', 'Jerusalem', 'Dubai', 'Bangkok', 'Singapore', 'Sydney',
    'Rome', 'Milan', 'Barcelona', 'Madrid', 'Berlin', 'Munich',
    'Amsterdam', 'Prague', 'Vienna', 'Budapest', 'Istanbul', 'Cairo',
    'Mumbai', 'Delhi', 'Beijing', 'Shanghai', 'Hong Kong', 'Seoul',
    'Toronto', 'Montreal', 'Vancouver', 'Mexico City', 'Rio de Janeiro',
    'Buenos Aires', 'Lima', 'Bogota', 'Cape Town', 'Johannesburg',
    'Haifa', 'Eilat', 'Nazareth', 'Tiberias', 'Ashdod', 'Netanya'
  ];
  
  // Check for known cities first (case-insensitive)
  for (const city of knownCities) {
    const regex = new RegExp(`\\b${city}\\b`, 'i');
    if (regex.test(text)) {
      const match = text.match(regex);
      if (match) {
        console.log(`Matched known city: "${city}"`);
        return city;
      }
    }
  }
   if (textLower.match(/\b(there|that place|this city|it)\b/)) {
    console.log(`Text contains contextual reference, not extracting city`);
    return null;}

  // Patterns for extracting cities
  const weatherPatterns = [
    // "weather in X", "forecast for X", "temperature in X"
    /(?:weather|forecast|climate|temperature|temp)\s+(?:in|for|at|of)\s+([A-Za-z]+(?:\s+[A-Za-z]+){0,2})/i,
    // "X weather", "X forecast"  
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(?:weather|forecast|climate|temperature)/i,
    // "in X today/tomorrow"
    /\bin\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(?:today|tomorrow|now)/i,
    // Generic "in/at/for [Capitalized Word(s)]"
    /\b(?:in|at|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/i
  ];

  for (const pattern of weatherPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      let city = match[1].trim();
      
      // Clean up common artifacts
      city = city.replace(/\s+(today|tomorrow|next|this|weather|forecast|in|on|at)$/i, '');
      city = city.replace(/[?\.,!]$/, '');
      city = city.trim();

      const invalidPhrases = [
        'No Rain', 'No Snow', 'No Wind', 'No Cloud',
        'High Temperature', 'Low Temperature', 'The Weather',
        'Bad Weather', 'Good Weather', 'Nice Weather',
        'ExternalContext', 'LLM knowledge', 'Sources:', 'TL;DR:', 'Response time:'
      ];

        if (invalidPhrases.some(phrase => city.toLowerCase().includes(phrase.toLowerCase()))) {
        continue; // Skip this match
      }
      // Filter out common false positives
      const stopWords = [
        'weather', 'forecast', 'temperature', 'climate', 
        'the', 'what', 'how', 'when', 'where', 'will', 'be', 'it',
        'there', 'here', 'this', 'that', 'should', 'could', 'would',
        'january', 'february', 'march', 'april', 'may', 'june',
        'july', 'august', 'september', 'october', 'november', 'december'
      ];
      
      if (!stopWords.includes(city.toLowerCase()) && city.length > 2) {
          city = city.split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
        
        console.log(`Extracted city via pattern: "${city}"`);
        return city;
        }
      }
    }
      console.log(`No city found in text: "${text.substring(0, 100)}..."`);
  return null;
  }



// Enhanced weather function with 5-day forecast
async function getWeatherForecast(city: string, daysAhead: number) {
  const apiKey = process.env.OPENWEATHER_KEY;
  if (!apiKey) {
    console.log("No OpenWeather API key found");
    return null;
  }

  // Check if request is beyond 5 days
  if (daysAhead > 5) {
    return {
      error: "BEYOND_FORECAST_RANGE",
      message: "I can only provide forecasts up to 5 days ahead"
    };
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&units=metric&appid=${apiKey}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      console.log(`Weather API error: ${response.status} - ${response.statusText}`);
      const errorText = await response.text();
      console.log(`Error details: ${errorText}`);
      return null;
    }

    const data = await response.json() as ForecastData;
    
    // Process forecast data for the requested day
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + daysAhead);
    targetDate.setHours(12, 0, 0, 0); // Noon for day comparison

    // Find forecasts for the target day (OpenWeather gives 3-hour intervals)
    const targetDateStr = targetDate.toISOString().split('T')[0];
    console.log(`Looking for forecasts for date: ${targetDateStr}`);
    
    const dayForecasts = data.list.filter(item => 
      item.dt_txt.startsWith(targetDateStr)
    );

    console.log(`Found ${dayForecasts.length} forecasts for ${targetDateStr}`);
    console.log(`Sample forecast times for ${targetDateStr}:`, dayForecasts.slice(0, 3).map(item => item.dt_txt));
    
    if (dayForecasts.length > 0) {
      // Log some actual forecast data to verify it's correct
      console.log(`Sample forecast data:`, {
        time: dayForecasts[0].dt_txt,
        temp: dayForecasts[0].main.temp,
        description: dayForecasts[0].weather[0].description
      });
    }

    if (dayForecasts.length === 0) {
      console.log(`No forecasts found for ${targetDateStr}, checking nearby dates...`);
      
      // Try to find the closest available date
      const availableDates = data.list.map(item => item.dt_txt.split(' ')[0]);
      const uniqueDates = [...new Set(availableDates)];
      console.log(`Available forecast dates: ${uniqueDates.join(', ')}`);
      
      // If we can't find the exact date, use the closest one
      if (uniqueDates.length > 0) {
        const closestDate = uniqueDates.find(date => date >= targetDateStr) || uniqueDates[uniqueDates.length - 1];
        console.log(`Using closest date: ${closestDate}`);
        
        const closestForecasts = data.list.filter(item => 
          item.dt_txt.startsWith(closestDate)
        );
        
        if (closestForecasts.length > 0) {
          const temps = closestForecasts.map(f => f.main.temp);
          const conditions = closestForecasts.map(f => f.weather[0].description);
          const rainProbs = closestForecasts.map(f => f.pop * 100);

          return {
            location: `${data.city.name}, ${data.city.country}`,
            date: closestDate,
            day_name: new Date(closestDate).toLocaleDateString('en-US', { weekday: 'long' }),
            temp_min: Math.min(...temps),
            temp_max: Math.max(...temps),
            temp_avg: Math.round(temps.reduce((a, b) => a + b, 0) / temps.length),
            conditions: [...new Set(conditions)],
            rain_probability: Math.round(Math.max(...rainProbs)),
            humidity: closestForecasts[Math.floor(closestForecasts.length / 2)]?.main.humidity || 0,
            wind_speed: closestForecasts[Math.floor(closestForecasts.length / 2)]?.wind.speed || 0,
            raw_forecasts: closestForecasts.slice(0, 3),
            note: `Using closest available forecast data for ${new Date(closestDate).toLocaleDateString('en-US', { weekday: 'long' })} (${closestDate}) - this was the closest to your requested ${targetDateStr}`
          };
        }
      }
      
      return null;
    }

    // Calculate day summary from available forecasts
    const temps = dayForecasts.map(f => f.main.temp);
    const conditions = dayForecasts.map(f => f.weather[0].description);
    const rainProbs = dayForecasts.map(f => f.pop * 100);

    return {
      location: `${data.city.name}, ${data.city.country}`,
      date: targetDateStr,
      temp_min: Math.min(...temps),
      temp_max: Math.max(...temps),
      temp_avg: temps.reduce((a, b) => a + b, 0) / temps.length,
      conditions: [...new Set(conditions)], // unique conditions
      rain_probability: Math.max(...rainProbs),
      humidity: dayForecasts[Math.floor(dayForecasts.length / 2)]?.main.humidity || 0,
      wind_speed: dayForecasts[Math.floor(dayForecasts.length / 2)]?.wind.speed || 0,
      raw_forecasts: dayForecasts.slice(0, 3) // First 3 forecasts for detail
    };
  } catch (error) {
    console.log("Weather API error:", error);
    return null;
  }
}



// LLM API call (unchanged)
async function callLLM(messages: Array<{ role: string; content: string }>) {
  const apiUrl = process.env.LLM_API_URL;
  if (!apiUrl) {
    throw new Error("LLM_API_URL not configured");
  }

  try {
    const requestBody = {
      model: "llama3.1:8b",
      messages,
      stream: false,
      options: {
        temperature: 0.3,
        num_predict: 250, 
        top_p: 0.7,
        repeat_penalty: 1.2
      }
    };

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`Ollama API error: ${response.status} - ${errorText}`);
      return {
        choices: [{
          message: {
            content: "Sorry, I'm having trouble connecting to Ollama. Make sure it's running."
          }
        }]
      };
    }

    return await response.json() as LLMResponse;
  } catch (error) {
    console.log("Ollama API error:", error);
    return {
      choices: [{
        message: {
          content: "Sorry, I'm having trouble processing that request."
        }
      }]
    };
  }
}

// Enhanced main chat endpoint
app.post("/chat", async (req, res) => {
  try {
    const { conversation_id, message } = req.body as {
      conversation_id?: string;
      message: string;
    };

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const convoId = conversation_id || "default";

    if (!conversations.has(convoId)) {
      conversations.set(convoId, []);
      conversationManager.initConversation(convoId);
    }
    
    const conv = conversations.get(convoId)!;
    let isProbablyCityResponse = false;
        if (conv.length > 0) {
          const lastAssistantMsg = [...conv].reverse().find(m => m.role === 'assistant');
          if (lastAssistantMsg?.text.toLowerCase().includes('which city')) {
            isProbablyCityResponse = true;
            console.log('User is likely responding with a city name');
          }
        }
    const clarificationNeeded = isProbablyCityResponse ? null : needsClarification(message, conv);
    const userMessage = {
      role: "user" as const,
      text: message,
      ts: Date.now()
    };
      conv.push(userMessage);
      if (clarificationNeeded) {
        conv.push({
          role: "assistant",
          text: clarificationNeeded,
          ts: Date.now()
        });
        return res.json({
          reply: clarificationNeeded,
          conversation_id: convoId,
          debug: {
            clarification_requested: true
          }
        });}
    if (conversationManager) {
        await conversationManager.updateMemory(convoId, userMessage);}

    // Check if we need external weather data
    let externalContext: any = null;
    let detectedCity: string | null = null;
    
      if (isProbablyCityResponse) {
      const city = extractCityName(message, conv);
      if (city) {
        console.log(`Treating city response "${city}" as weather query`);
        detectedCity = city;
        
        const dayInfo = { targetDay: 'today', daysAhead: 0 }; // Default to today
        const weather = await getWeatherForecast(city, dayInfo.daysAhead);
        
        if (weather && !weather.error) {
          externalContext = { 
            weather,
            query_day: dayInfo.targetDay,
            days_ahead: dayInfo.daysAhead
          };
        }
      }
    } else if (needsExternal(message)) {
      const city = extractCityName(message,conv);
      detectedCity = city;
      
      if (!city) {
        // No city found - ask for clarification instead of defaulting
        const replyText = "I'd be happy to help with weather information! Could you please specify which city you're asking about? For example: 'weather in Paris tomorrow' or 'forecast for New York on Friday'.";
        
        conv.push({
          role: "assistant", 
          text: replyText,
          ts: Date.now()
        });

        return res.json({
          reply: replyText,
          conversation_id: convoId
        });
      }
      
      const dayInfo = extractDayInfo(message);

      // Check if the requested day is beyond our 5-day forecast limit
      if (dayInfo.daysAhead > 5) {
        const replyText = `I can only provide weather forecasts up to 5 days ahead. ${dayInfo.targetDay.charAt(0).toUpperCase() + dayInfo.targetDay.slice(1)} is ${dayInfo.daysAhead} days away, which is beyond my forecast range. For longer-term planning, I'd recommend checking reliable weather services closer to your travel date.`;
        
        conv.push({
          role: "assistant", 
          text: replyText,
          ts: Date.now()
        });

        return res.json({
          reply: replyText,
          conversation_id: convoId
        });
      }
      
      console.log(`Detected weather query for: "${city}" (${dayInfo.daysAhead} days ahead: ${dayInfo.targetDay})`);

      const weather = await getWeatherForecast(city, dayInfo.daysAhead);
      console.log(`Weather API response for ${city}:`, weather ? 'Success' : 'Failed');
      
      if (weather) {
        if (weather.error === "BEYOND_FORECAST_RANGE") {
          // Handle beyond 5-day requests immediately
          const replyText = "I can only provide weather forecasts up to 5 days ahead. For longer-term planning, I'd recommend checking reliable weather services closer to your travel date. Would you like me to help with something else about your trip?";
          
          conv.push({
            role: "assistant", 
            text: replyText,
            ts: Date.now()
          });

          return res.json({
            reply: replyText,
            conversation_id: convoId
          });
        }
        
        externalContext = { 
          weather,
          query_day: dayInfo.targetDay|| "Today",
          days_ahead: dayInfo.daysAhead,
          note: dayInfo.daysAhead === 0 
    ? "User did not specify a day, so defaulting to today" 
    : undefined
        };
      } else {
        // Weather API failed - ask if user wants us to try again or help differently
        const replyText = `I'm having trouble getting current weather data for ${city}. This could be due to the city name or a temporary API issue. Could you try rephrasing the city name, or would you like me to help with other travel planning for ${city}?`;
        
        conv.push({
          role: "assistant", 
          text: replyText,
          ts: Date.now()
        });

        return res.json({
          reply: replyText,
          conversation_id: convoId
        });
      }
    }
    const queryComplexity = isComplexQuery(message);
    // Build messages for LLM
    const recentMessages = conv.slice(-6);
    const llmMessages: Array<{ role: string; content: string }> = [];
    let systemContent = SYSTEM_PROMPT;
    const userContext = conversationManager.getContextString(convoId);
    if (userContext) {
      systemContent += userContext;
    }
    // Add system prompt with context if available
    if (externalContext) {
      systemContent += `\n\nExternalContext: ${JSON.stringify(externalContext, null, 2)}`;
    } 
    else if (queryComplexity){
      systemContent += `\n\n[COMPLEX] \nNote: This is a complex query requiring step-by-step planning.`;
    }
    llmMessages.push({ role: "system", content: systemContent });

    // Add conversation history
    recentMessages.forEach(msg => {
      llmMessages.push({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.text
      });
    });

    // Call LLM
    console.log("Calling LLM with messages:", llmMessages.length);
    const startTime = Date.now();
    const llmResponse = await callLLM(llmMessages);
    const responseTime = Date.now() - startTime;

    const responseLength = llmResponse?.choices?.[0]?.message?.content?.length || 0;
    console.log(`LLM Response: ${responseTime}ms, ${responseLength} chars`);

    // Extract response
    let assistantText = llmResponse?.choices?.[0]?.message?.content || 
      "I'm having trouble generating a response right now. Please try again.";
    assistantText = cleaner.clean(assistantText);

    const validation = await hallucinationDetector.validateResponse(
      assistantText,
      externalContext,
      true 
    );

    if (!validation.valid && validation.confidence! > 70) {
      console.log("High confidence hallucination detected, regenerating with stricter prompt");
      
      const stricterSystemPrompt = SYSTEM_PROMPT + 
        "\n\nIMPORTANT: Previous response had accuracy issues. " +
        "Only state facts you're certain about. Use 'typically', 'usually', " +
        "'approximately', or 'around' for uncertain information. " +
        "Never state specific prices, times, or data without a source.";
      
      const stricterMessages = [
        { role: "system", content: stricterSystemPrompt + (externalContext ? `\n\nExternalContext: ${JSON.stringify(externalContext, null, 2)}` : '') },
        ...llmMessages.slice(1) 
      ];
      
      const retryResponse = await callLLM(stricterMessages);
      const retryText = retryResponse?.choices?.[0]?.message?.content || assistantText;
      
      const retryValidation = await hallucinationDetector.validateResponse(
        retryText,
        externalContext,
        true
      );
      
      assistantText = retryValidation.response;
      
      console.log("Retry validation result:", {
        wasFixed: retryValidation.wasFixed,
        confidence: retryValidation.confidence
      });
    } else {
      assistantText = validation.response;
      
      if (validation.wasFixed) {
        console.log("Minor hallucinations auto-fixed");
      }
    }


   const assistantMessage = {
      role: "assistant" as const,
      text: assistantText,
      ts: Date.now()
    };
    conv.push(assistantMessage);

    if (conversationManager) {
      await conversationManager.updateMemory(convoId, assistantMessage);}
    
    res.json({
      reply: assistantText,
      externalContext,
      conversation_id: convoId,
      debug: {
        city_detected: detectedCity,
        days_ahead: externalContext?.days_ahead || null,
        is_complex: queryComplexity
      }
    });

  } catch (error) {
    console.error("Chat endpoint error:", error);
    res.status(500).json({
      error: "Internal server error",
      reply: "Sorry, something went wrong. Please try again."
    });
  }
});

// Serve static files
app.use(express.static("static"));

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    conversations: conversations.size
  });
});

app.get("/stats/:conversationId", (req, res) => {
  const { conversationId } = req.params;
  const stats = conversationManager.getStats(conversationId);
  
  if (!stats) {
    return res.status(404).json({ error: "Conversation not found" });
  }
  
  res.json(stats);
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Travel Assistant server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});