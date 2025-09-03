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
    cleaned = cleaned.replace(/\s{2,}/g, ' ');
    
    // Clean up numbered lists that have meta-labels
    cleaned = cleaned.replace(/(\d+\.)\s*:\s*/g, '$1 ');
    
    // Remove [COMPLEX] markers
    cleaned = cleaned.replace(/\[COMPLEX\]/gi, '');

    // Fix numbered list formatting in Plan section
    cleaned = cleaned.replace(/Plan:\s*(\d+\.)/g, 'Plan:\n$1');
    cleaned = cleaned.replace(/(\d+\.)\s*/g, '\n$1 ');

     // Fix TL;DR to be on same line as Recommendation
    cleaned = cleaned.replace(/Recommendation:\s*\n*TL;DR:/g, '\nRecommendation:\nTL;DR:');
    
    // Fix Plan: and Recommendation: formatting
    cleaned = cleaned.replace(/^\s*Plan:\s*$/gm, 'Plan:');
    cleaned = cleaned.replace(/^\s*Recommendation:\s*$/gm, '\nRecommendation:');

      // Ensure bullet points are on new lines
    //cleaned = cleaned.replace(/([.!?])\s*•/g, '$1\n•');
    //cleaned = cleaned.replace(/•/g, '\n•');
    cleaned = cleaned.replace(/\s*•/g, '\n•');


     // Fix Sources to be on new line
    cleaned = cleaned.replace(/([^\n])\s*Sources:/g, '$1\n\nSources:');
    
      // Collapse multiple newlines to max 2
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    // Clean up extra whitespace
    cleaned = cleaned.replace(/[ \t]+$/gm, '');
    cleaned = cleaned.trim();
    
    return cleaned;
  }
}
export default SystemLeakageCleaner;