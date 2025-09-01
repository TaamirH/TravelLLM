import express from "express";
import dotenv from "dotenv";

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

// Store conversations in memory
const conversations = new Map<string, Message[]>();

// Enhanced system prompt with forecast capabilities
const SYSTEM_PROMPT = `You are TravelGenie, a concise, helpful travel planning assistant.

CRITICAL: NEVER make up specific weather data, prices, or times. If you don't have ExternalContext data, say "I don't know - want me to check?"

Keep responses under 250 words.

RESPONSE FORMAT:
TL;DR: [One sentence summary]
• [2-3 bullet points with practical advice - use plain text, no asterisks or formatting]  
• [One short encouragement, caution, or extra note]

Sources: [ExternalContext(OpenWeatherApp) used or "LLM knowledge"]

WEATHER HANDLING:
- If user does not specify a day, assume they mean "today"
- If ExternalContext contains forecast data, use it and cite "ExternalContext weather forecast"
- For dates beyond 5 days, say "I can only provide forecasts up to 5 days ahead"
- IMPORTANT: Always use the EXACT day from the query - do not say "tomorrow" unless the user asked about tomorrow
- If ExternalContext contains a "note" field, mention this limitation to the user
- Include temperature range, conditions, and rain probability when available
- Be specific about which day you're forecasting for


RULES:
- Ask clarifying questions if user's request is vague
- If ExternalContext is provided, use that data and cite it  
- For complex planning, show brief reasoning before recommendation
- Stay consistent with previous conversation context
- Use plain text formatting (no ** or markdown)
- Be specific and actionable

Example with forecast:
Q: "Weather in Paris tomorrow?"
A: TL;DR: Paris tomorrow will be 18-22°C with light rain (60% chance).
• Pack umbrella and light waterproof jacket
• Morning looks clearer, plan outdoor activities early
• Good day for museums if rain persists

Perfect for exploring covered markets!
Sources: ExternalContext weather forecast`;

// Enhanced decision logic for external API calls
function needsExternal(query: string): boolean {
  const weatherKeywords = [
    "weather", "temperature", "forecast", "climate", "rain", "sunny", "cloudy",
    "today", "now", "current", "tomorrow", "next week", 
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "this week", "weekend", "hot", "cold", "warm", "cool"
  ];
  const q = query.toLowerCase();
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

// Improved city extraction with better regex patterns
function extractCityName(query: string): string | null {
  const patterns = [
    // "weather in Paris tomorrow", "weather in Paris in Thursday"
    /(?:weather|forecast|climate|temperature)\s+in\s+([A-Za-z][\w\s,.-]+?)(?:\s+(?:in\s+)?(?:today|tomorrow|tommorow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this|next|on|\?|$))/i,
    // "forecast for Los Angeles"  
    /(?:forecast|weather|climate|temperature)\s+for\s+([A-Za-z][\w\s,.-]+?)(?:\s+(?:today|tomorrow|tommorow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this|next|on|\?|$))/i,
    // "Paris weather", "Los Angeles forecast"
    /^([A-Za-z][\w\s,.-]+?)\s+(?:weather|forecast|climate|temperature)/i,
    // Generic "in City" pattern - also catches "weather in paris?" (without day)
    /\bin\s+([A-Za-z][\w\s,.-]+?)(?:\s+(?:in\s+)?(?:today|tomorrow|tommorow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this|next|on|\?|$))/i,
    // Simple "weather city" pattern - catches "weather paris"
    /^(?:weather|forecast|climate|temperature)\s+([A-Za-z][\w\s,.-]+?)(?:\?|$)/i,
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match && match[1]) {
      let city = match[1].trim();
      // Clean up common artifacts
      city = city.replace(/\s+(today|tomorrow|tommorow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this|next|on|in)$/i, '');
      city = city.replace(/\?$/, ''); // Remove trailing question mark
      city = city.trim();
      
      // Filter out common false positives
      const stopWords = ['weather', 'forecast', 'temperature', 'climate', 'the', 'what', 'how', 'when', 'where', 'will', 'be', 'it'];
      if (!stopWords.includes(city.toLowerCase()) && city.length > 1) {
        console.log(`Extracted city: "${city}" from query: "${query}"`);
        return city;
      }
    }
  }

  console.log(`No city found in "${query}"`);
  return null; // Return null instead of defaulting
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
        num_predict: 250, // Slightly increased for forecast details
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

    // Initialize conversation if needed
    if (!conversations.has(convoId)) {
      conversations.set(convoId, []);
    }

    const conv = conversations.get(convoId)!;

    // Store user message
    conv.push({
      role: "user",
      text: message,
      ts: Date.now()
    });

    // Check if we need external weather data
    let externalContext: any = null;
    let detectedCity: string | null = null;
    
    if (needsExternal(message)) {
      const city = extractCityName(message);
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

    // Build messages for LLM
    const recentMessages = conv.slice(-6);
    const llmMessages: Array<{ role: string; content: string }> = [];

    // Add system prompt with context if available
    if (externalContext) {
      const systemWithContext = `${SYSTEM_PROMPT}\n\nExternalContext: ${JSON.stringify(externalContext, null, 2)}`;
      llmMessages.push({ role: "system", content: systemWithContext });
    } else {
      llmMessages.push({ role: "system", content: SYSTEM_PROMPT });
    }

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
    const assistantText = llmResponse?.choices?.[0]?.message?.content || 
      "I'm having trouble generating a response right now. Please try again.";

    // Store assistant response
    conv.push({
      role: "assistant",
      text: assistantText,
      ts: Date.now()
    });

    res.json({
      reply: assistantText,
      externalContext,
      conversation_id: convoId,
      debug: {
        city_detected: detectedCity,
        days_ahead: externalContext?.days_ahead || null
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Travel Assistant server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});