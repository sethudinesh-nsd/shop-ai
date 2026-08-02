// Theme toggle (light/dark button click feedback)
document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.theme-btn').forEach(b => b.style.opacity = '0.6');
    btn.style.opacity = '1';
  });
});

// Nav item active state
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
  });
});

// Heart / save toggle on product cards
document.querySelectorAll('.heart').forEach(heart => {
  heart.addEventListener('click', (e) => {
    e.stopPropagation();
    heart.textContent = heart.textContent === '🤍' ? '❤️' : '🤍';
  });
});

// Recommended carousel arrow (simple scroll-right effect)
const arrow = document.querySelector('.carousel-arrow');
const grid = document.querySelector('.rec-grid');
if (arrow && grid) {
  arrow.addEventListener('click', () => {
    grid.scrollBy({ left: 300, behavior: 'smooth' });
  });
}

// Prompt box submit
const sendBtn = document.querySelector('.send-btn');
const promptInput = document.querySelector('.prompt-box input');
if (sendBtn && promptInput) {
  sendBtn.addEventListener('click', () => {
    if (promptInput.value.trim() !== '') {
      console.log('Searching for:', promptInput.value);
      // hook up to your styling/search API here
      promptInput.value = '';
    }
  });
}
