export class HallucinationDetector {
  private suspiciousPatterns = [
    /exactly \$?\d+/gi,                       // "exactly 23" or "exactly $150"
    /precisely \$?\d+/gi,                     // "precisely 150" or "precisely $70"
    /\$\d{3,}\.\d{2}/g,                      // Very specific prices like "$123.45"
    /\b\d{1,2}:\d{2}\s*(AM|PM|am|pm)\b/g,    // Specific times like "3:45 PM"
    /\b(guaranteed|definitely|always|never)\b/gi,  // Absolute statements
  ];
  
  // Check response for potential hallucinations
  detectHallucinations(response: string, externalContext: any): {
    suspicious: boolean;
    issues: string[];
    confidence: number; // 0-65, focused on what we can verify
  } {
    const issues: string[] = [];
    let confidenceScore = 0;
    
    // MAIN CHECK: Weather-specific claims without external context
    if (!externalContext?.weather) {
      // Check for specific temperatures without data
      const tempMatches = response.match(/\d+°[CF]|\d+\s*degrees/gi);
      if (tempMatches) {
        issues.push('Specific temperature mentioned without weather data');
        confidenceScore += 30;
      }
      
      // Check for weather conditions without data
      const weatherTerms = response.match(/\b(rain|sunny|cloudy|storm|snow|fog|humid)\b/gi);
      if (weatherTerms && !response.includes('typically') && !response.includes('usually') && !response.includes('normally') && !response.includes('probably')) {
        issues.push('Weather conditions stated without data source');
        confidenceScore += 20;
      }
    }
    
    // Check for overly specific claims (prices, times, absolutes)
    // We still flag these as they indicate overconfidence, even without price API
    for (const pattern of this.suspiciousPatterns) {
      const matches = response.match(pattern);
      if (matches) {
        matches.forEach(match => {
          issues.push(`Overly specific claim: "${match}"`);
          confidenceScore += 5; // Lower confidence since we can't verify prices
        });
      }
    }
    
    // CHECK WITH CONTEXT: Contradictions with actual weather data
    if (externalContext?.weather) {
      this.checkWeatherContradictions(response, externalContext.weather, issues);
    }
    
    // Cap confidence at 65 since we only verify weather
    confidenceScore = Math.min(confidenceScore, 65);
    
    return {
      suspicious: issues.length > 0,
      issues,
      confidence: confidenceScore
    };
  }
  
  // Check for contradictions with weather API data
  private checkWeatherContradictions(response: string, weather: any, issues: string[]) {
    // Temperature contradiction check
    const tempMatches = response.match(/(\d+)°[CF]/g);
    if (tempMatches && weather.temp_avg !== undefined) {
      tempMatches.forEach(match => {
        const temp = parseInt(match);
        const apiTemp = Math.round(weather.temp_avg);
        
        // Allow 3-degree variance for rounding
        if (Math.abs(temp - apiTemp) > 3) {
          issues.push(`Temperature ${match} differs from API data (${apiTemp}°C)`);
        }
      });
    }
    
    // Rain probability contradiction check
    if (weather.rain_probability !== undefined) {
      const rainClaims = response.match(/(\d+)%\s*(?:chance|probability)?\s*(?:of)?\s*rain/gi);
      if (rainClaims) {
        rainClaims.forEach(claim => {
          const claimed = parseInt(claim);
          const actual = weather.rain_probability;
          if (Math.abs(claimed - actual) > 10) {
            issues.push(`Rain probability claim differs from API (actual: ${actual}%)`);
          }
        });
      }
    }
  }
  
  
fixHallucinations(originalResponse: string, issues: string[]): string {
  let fixed = originalResponse;
  
  // Fix overly specific numeric claims
  fixed = fixed.replace(/exactly (\$?\d+)/gi, 'approximately $1');
  fixed = fixed.replace(/precisely (\$?\d+)/gi, 'around $1');
  
  // Fix absolute statements
  fixed = fixed.replace(/\bguaranteed\b/gi, 'likely');
  fixed = fixed.replace(/\bdefinitely\b/gi, 'probably');
  fixed = fixed.replace(/\balways\b/gi, 'typically');
  fixed = fixed.replace(/\bnever\b/gi, 'rarely');
  
  // Fix specific times if flagged
  // Check if any issue mentions a time (contains AM or PM)
  const hasTimeIssue = issues.some(issue => 
    issue.includes('AM') || issue.includes('PM') || 
    issue.includes('am') || issue.includes('pm') ||
    issue.match(/\d{1,2}:\d{2}/)
  );
  
  if (hasTimeIssue) {
    // Replace "at TIME" with "around TIME"
    fixed = fixed.replace(/\bat\s+(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))\b/gi, 'around $1');
    
    // Also handle cases where "at" might not be present
    // Replace "TIME sharp" or just "TIME" in certain contexts
    fixed = fixed.replace(/(?<!\baround\s)(?<!\bat\s)(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))/gi, 
      (match, time) => {
        // Check if this time is in a sentence about schedules/tours/meals
        const beforeMatch = fixed.substring(Math.max(0, fixed.indexOf(match) - 50), fixed.indexOf(match));
        if (beforeMatch.match(/starts|begins|opens|served|scheduled|departs|arrives|closes/i)) {
          return `around ${time}`;
        }
        return match;
      }
    );
  }
  
  // Fix very specific prices like $123.45 to rounded amounts
  fixed = fixed.replace(/\$(\d{3,})\.(\d{2})/g, (match, dollars) => {
    const amount = parseInt(dollars);
    const rounded = Math.round(amount / 10) * 10;
    return `around $${rounded}`;
  });
  
  // Capitalize first letter after period if needed
  fixed = fixed.replace(/\. ([a-z])/g, (match, letter) => `. ${letter.toUpperCase()}`);
  
  return fixed;
}
  
  // Main validation method
  async validateResponse(
    response: string,
    externalContext: any,
    autoFix: boolean = true
  ): Promise<{
    valid: boolean;
    response: string;
    issues?: string[];
    confidence?: number;
    wasFixed?: boolean;
  }> {
    const detection = this.detectHallucinations(response, externalContext);
    
    // If no issues or low confidence, return as valid
    if (!detection.suspicious || detection.confidence < 30) {
      return { 
        valid: true, 
        response,
        confidence: detection.confidence 
      };
    }
    
    console.log(`Hallucination detected (confidence: ${detection.confidence}%):`, detection.issues);
    
    // For medium confidence (30-50), try to auto-fix
    if (autoFix && detection.confidence <= 50) {
      const fixed = this.fixHallucinations(response, detection.issues);
      return {
        valid: true,
        response: fixed,
        issues: detection.issues,
        confidence: detection.confidence,
        wasFixed: true
      };
    }
    
    // For high confidence (50-65), still try to fix but log warning
    if (autoFix && detection.confidence <= 65) {
      console.log('Warning: High confidence hallucination, applying fixes');
      const fixed = this.fixHallucinations(response, detection.issues);
      return {
        valid: true,
        response: fixed,
        issues: detection.issues,
        confidence: detection.confidence,
        wasFixed: true
      };
    }
    
    // Should rarely get here with 65 cap
    return {
      valid: false,
      response: response,
      issues: detection.issues,
      confidence: detection.confidence,
      wasFixed: false
    };
  }
}