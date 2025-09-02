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
    
    // Fix Plan: and Recommendation: formatting
    cleaned = cleaned.replace(/^\s*Plan:\s*$/gm, 'Plan:');
    cleaned = cleaned.replace(/^\s*Recommendation:\s*$/gm, 'Recommendation:');
    
    // Clean up extra whitespace
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    cleaned = cleaned.trim();
    
    return cleaned;
  }
}
export default SystemLeakageCleaner;