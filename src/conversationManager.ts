// CREATE NEW FILE: src/conversationManager.ts
import { Message } from './types'

interface UserPreferences {
  budget?: 'budget' | 'moderate' | 'luxury';
  interests?: string[];
  travelStyle?: 'adventure' | 'relaxation' | 'cultural' | 'mixed';
  dietaryRestrictions?: string[];
  mobilityNeeds?: string[];
}

interface TripPlan {
  destination: string;
  dates?: { start?: string; end?: string };
  purpose?: string;
  budget?: number;
  activities?: string[];
}

interface ConversationMemory {
  messages: Message[];
  summary?: string;
  userPreferences: UserPreferences;
  mentionedLocations: Set<string>;
  plannedTrips: TripPlan[];
}

export class ConversationManager {
  private memories = new Map<string, ConversationMemory>();
  
  // Initialize a new conversation
  initConversation(conversationId: string) {
    if (!this.memories.has(conversationId)) {
      this.memories.set(conversationId, {
        messages: [],
        userPreferences: {},
        mentionedLocations: new Set(),
        plannedTrips: []
      });
    }
  }
  
  // Extract preferences from user message
  extractPreferences(message: string, existing: UserPreferences): UserPreferences {
    const updated = { ...existing };
    
    // Budget detection
    if (message.match(/budget|cheap|affordable|backpack/i)) {
      updated.budget = 'budget';
    } else if (message.match(/luxury|high-end|premium|first class/i)) {
      updated.budget = 'luxury';
    } else if (message.match(/moderate|mid-range|comfortable/i)) {
      updated.budget = 'moderate';
    }
    
    // Interest detection
    const interests = [];
    if (message.match(/museum|art|history|culture|temple|monument/i)) interests.push('culture');
    if (message.match(/beach|hiking|outdoor|nature|mountain|park/i)) interests.push('nature');
    if (message.match(/food|restaurant|cuisine|eat|culinary|street food/i)) interests.push('food');
    if (message.match(/shopping|mall|market|souvenir/i)) interests.push('shopping');
    if (message.match(/nightlife|club|bar|party|pub/i)) interests.push('nightlife');
    if (message.match(/adventure|extreme|adrenaline|diving|climbing/i)) interests.push('adventure');
    
    if (interests.length > 0) {
      updated.interests = [...new Set([...(updated.interests || []), ...interests])];
    }
    
    // Dietary restrictions
    if (message.match(/vegetarian|vegan|halal|kosher|gluten/i)) {
      const restrictions = message.match(/(vegetarian|vegan|halal|kosher|gluten-free)/gi);
      if (restrictions) {
        updated.dietaryRestrictions = [...new Set(restrictions.map(r => r.toLowerCase()))];
      }
    }
    
    return updated;
  }
  
  // Extract locations from message
  extractLocations(message: string): string[] {
    const locations: string[] = [];
    
    // Common city patterns
    const cityPatterns = [
      /(?:visit|go to|travel to|fly to|in|at)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g,
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:trip|vacation|holiday)/g,
    ];
    
    for (const pattern of cityPatterns) {
      let match;
      while ((match = pattern.exec(message)) !== null) {
        const location = match[1];
        // Filter out common false positives
        if (location.length > 2 && 
            !['I', 'The', 'This', 'That', 'When', 'Where', 'What', 'How', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].includes(location)) {
          locations.push(location);
        }
      }
    }
    
    return locations;
  }
  
  // Update memory with new message
  async updateMemory(conversationId: string, message: Message) {
    this.initConversation(conversationId);
    const memory = this.memories.get(conversationId)!;
    
    memory.messages.push(message);
    
    // Only extract from user messages
    if (message.role === 'user') {
      // Update preferences
      memory.userPreferences = this.extractPreferences(message.text, memory.userPreferences);
      
      // Extract and store locations
      const locations = this.extractLocations(message.text);
      locations.forEach(loc => memory.mentionedLocations.add(loc));
    }
  }
  
  // Get context string for LLM
  getContextString(conversationId: string): string {
    const memory = this.memories.get(conversationId);
    if (!memory) return '';
    
    const contextParts = [];
    
    // Add user preferences
    if (memory.userPreferences.budget) {
      contextParts.push(`User Budget Level: ${memory.userPreferences.budget}`);
    }
    if (memory.userPreferences.interests?.length) {
      contextParts.push(`User Interests: ${memory.userPreferences.interests.join(', ')}`);
    }
    if (memory.userPreferences.dietaryRestrictions?.length) {
      contextParts.push(`Dietary Restrictions: ${memory.userPreferences.dietaryRestrictions.join(', ')}`);
    }
    
    // Add mentioned locations (limit to last 5 to avoid context bloat)
    if (memory.mentionedLocations.size > 0) {
      const recentLocations = Array.from(memory.mentionedLocations).slice(-5);
      contextParts.push(`Previously Discussed Locations: ${recentLocations.join(', ')}`);
    }
    
    return contextParts.length > 0 
      ? `\n\nUser Profile & Context:\n${contextParts.join('\n')}` 
      : '';
  }
  
  // Get statistics
  getStats(conversationId: string) {
    const memory = this.memories.get(conversationId);
    if (!memory) return null;
    
    return {
      messageCount: memory.messages.length,
      locationsDiscussed: memory.mentionedLocations.size,
      hasPreferences: Object.keys(memory.userPreferences).length > 0,
      preferences: memory.userPreferences
    };
  }
}