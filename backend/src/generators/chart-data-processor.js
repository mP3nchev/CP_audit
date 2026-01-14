/**
 * Chart Data Processor
 * Prepares data for Chart.js visualizations in HTML report
 */

/**
 * Process cookie categories for pie chart
 * @param {Array} cookies - Detected cookies
 * @returns {Object} Chart data
 */
function processCookieCategoriesChart(cookies) {
  const categories = {
    essential: 0,
    analytics: 0,
    advertising: 0,
    social_media: 0,
    marketing: 0,
    preferences: 0,
    unknown: 0
  };

  cookies.forEach(cookie => {
    const category = cookie.category || 'unknown';
    if (categories[category] !== undefined) {
      categories[category]++;
    } else {
      categories.unknown++;
    }
  });

  return {
    labels: JSON.stringify(Object.keys(categories).map(key =>
      key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    )),
    data: JSON.stringify(Object.values(categories))
  };
}

/**
 * Process privacy policy criteria for bar chart
 * @param {Array} criteria - GDPR criteria
 * @returns {Object} Chart data
 */
function processCriteriaChart(criteria) {
  if (!criteria || criteria.length === 0) {
    return {
      labels: JSON.stringify([]),
      scores: JSON.stringify([])
    };
  }

  // Group by tier and take top 15 criteria by weight
  const sortedCriteria = criteria
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 15);

  const labels = sortedCriteria.map(c =>
    c.name.length > 30 ? c.name.substring(0, 30) + '...' : c.name
  );

  const scores = sortedCriteria.map(c => c.score || 0);

  return {
    labels: JSON.stringify(labels),
    scores: JSON.stringify(scores)
  };
}

/**
 * Process cookie comparison for bar chart
 * @param {Object} comparison - Cookie comparison result
 * @returns {Object} Chart data
 */
function processCookieComparisonChart(comparison) {
  if (!comparison) {
    return {
      data: JSON.stringify([0, 0, 0])
    };
  }

  return {
    data: JSON.stringify([
      comparison.matched?.length || 0,
      comparison.undeclared?.length || 0,
      comparison.missing?.length || 0
    ])
  };
}

/**
 * Calculate score color based on grade
 * @param {string} grade - Letter grade
 * @returns {Object} Colors
 */
function getScoreColors(grade) {
  const colorMap = {
    'A': { color: '#10b981', dark: '#059669' },  // Green
    'B': { color: '#22c55e', dark: '#16a34a' },  // Light green
    'C': { color: '#eab308', dark: '#ca8a04' },  // Yellow
    'D': { color: '#f59e0b', dark: '#d97706' },  // Orange
    'F': { color: '#ef4444', dark: '#dc2626' }   // Red
  };

  return colorMap[grade] || colorMap['F'];
}

/**
 * Get grade category name
 * @param {string} grade - Letter grade
 * @returns {string} Category name
 */
function getGradeCategory(grade) {
  const categoryMap = {
    'A': 'Excellent',
    'B': 'Good',
    'C': 'Fair',
    'D': 'Poor',
    'F': 'Critical'
  };

  return categoryMap[grade] || 'Unknown';
}

/**
 * Format risk level class
 * @param {string} riskLevel - Risk level
 * @returns {string} CSS class
 */
function getRiskLevelClass(riskLevel) {
  const classMap = {
    'Critical': 'critical',
    'High': 'high',
    'Medium': 'medium',
    'Low': 'low'
  };

  return classMap[riskLevel] || 'medium';
}

/**
 * Get noyb badge class and color
 * @param {number} percentage - Pass percentage
 * @returns {Object} Badge styling
 */
function getNoybBadgeStyle(percentage) {
  if (percentage >= 90) {
    return { class: 'badge-pass', color: '#10b981' };
  } else if (percentage >= 70) {
    return { class: 'badge-low', color: '#22c55e' };
  } else if (percentage >= 50) {
    return { class: 'badge-medium', color: '#eab308' };
  } else {
    return { class: 'badge-critical', color: '#ef4444' };
  }
}

/**
 * Format currency (EUR)
 * @param {number} amount - Amount in EUR
 * @returns {string} Formatted amount
 */
function formatEUR(amount) {
  return new Intl.NumberFormat('en-EU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

/**
 * Format date
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date
 */
function formatDate(dateString) {
  if (!dateString) return 'N/A';

  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (error) {
    return dateString;
  }
}

/**
 * Truncate text
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
function truncate(text, maxLength = 100) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Get status icon
 * @param {boolean} passed - Whether check passed
 * @returns {string} Icon HTML
 */
function getStatusIcon(passed) {
  return passed
    ? '<span class="status-icon status-pass">✓</span>'
    : '<span class="status-icon status-fail">✗</span>';
}

/**
 * Get severity badge
 * @param {string} severity - Severity level
 * @returns {string} Badge HTML
 */
function getSeverityBadge(severity) {
  const classMap = {
    'critical': 'badge-critical',
    'high': 'badge-high',
    'medium': 'badge-medium',
    'low': 'badge-low'
  };

  const className = classMap[severity?.toLowerCase()] || 'badge-medium';
  return `<span class="badge ${className}">${severity || 'Unknown'}</span>`;
}

/**
 * Escape HTML
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  if (!text) return '';

  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };

  return text.replace(/[&<>"']/g, m => map[m]);
}

module.exports = {
  processCookieCategoriesChart,
  processCriteriaChart,
  processCookieComparisonChart,
  getScoreColors,
  getGradeCategory,
  getRiskLevelClass,
  getNoybBadgeStyle,
  formatEUR,
  formatDate,
  truncate,
  getStatusIcon,
  getSeverityBadge,
  escapeHtml
};
