class SystemLeakageCleaner {
  clean(response: string): string {
    let cleaned = response;
    
    // Remove common meta-labels that leak through
    const metaLabels = [
        /Identify (?:key )?requirements?[^.]*\./gi,
        /Consider constraints?[^.]*\./gi,
        /Evaluate options?[^.]*\./gi,
        /Prioritize recommendations?[^.]*\./gi,
        /requirements from[^.]*\./gi,
        /constraints for[^.]*\./gi,
        /\*\*Options\*\*:?/gi,
        /\*\*Caveat\*\*:?/gi,
        /\*\*Important caveat\*\*:?/gi,
        /\*\*Note\*\*:?/gi,
        /\*\*Important\*\*:?/gi,
        /Identify key requirements:?/gi,
        /Consider constraints:?/gi,
        /Evaluate options:?/gi,
        /Prioritize recommendations:?/gi,
        /from the user \([^)]+\)/gi,
        /for this time: [^.]+\./gi,
        /based on [^.]+\./gi,
        /Account for [^.]+\./gi,
        /based on[^.]*attractions/gi,

    ];
    
    metaLabels.forEach(pattern => {
      cleaned = cleaned.replace(pattern, '');
    });
    
   // Remove all ** formatting
    cleaned = cleaned.replace(/\*\*/g, '');
    
    // Fix any double colons or spaces
    cleaned = cleaned.replace(/:\s*:/g, ':');
    
    // Clean up numbered lists that have meta-labels (: after number)
    cleaned = cleaned.replace(/(\d+\.)\s*:\s*/g, '$1 ');
    
    // IMPORTANT: Fix Plan section formatting WITHOUT removing content
    // First, ensure Plan: is on its own line
    cleaned = cleaned.replace(/([^\n])\s*Plan:/g, '$1\n\nPlan:');
    
    // Then, fix numbered items to be on separate lines
    // Match "Plan: 1. text 2. text" and convert to proper line breaks
    cleaned = cleaned.replace(/Plan:\s*(\d+\.)/g, 'Plan:\n$1');
    
    // Fix subsequent numbered items (but preserve their content!)
    // This regex looks for "text. 2." pattern and adds newline before the number
    cleaned = cleaned.replace(/([^0-9])\s+(\d+\.)\s+/g, '$1\n$2 ');
    
    // Fix Recommendation section
    // Ensure Recommendation appears on new line after Plan content
    cleaned = cleaned.replace(/([^\n])\s*Recommendation:/g, '$1\n\nRecommendation:');
    
    // Fix TL;DR to be right after Recommendation
    cleaned = cleaned.replace(/Recommendation:\s*\n*\s*TL;DR:/g, 'Recommendation:\nTL;DR:');
    
    // Ensure bullet points are on new lines (but preserve content)
    cleaned = cleaned.replace(/([^\n])\s*•/g, '$1\n•');
    
    // Fix Sources to be on new line
    cleaned = cleaned.replace(/([^\n])\s*Sources:/g, '$1\n\nSources:');
    
    // Clean up excessive whitespace
    cleaned = cleaned.replace(/\s{3,}/g, '  '); // Replace 3+ spaces with 2
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n'); // Max 2 newlines
    cleaned = cleaned.replace(/[ \t]+$/gm, ''); // Remove trailing spaces
    
    // Final cleanup
    cleaned = cleaned.trim();
    
    return cleaned;
  }
}
export default SystemLeakageCleaner;