const preference = localStorage.getItem('ceston.theme') ?? 'system';
document.documentElement.dataset.theme = preference === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference;
export function setTheme(value: string) {
  localStorage.setItem('ceston.theme', value);
  document.documentElement.dataset.theme = value === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : value;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ((localStorage.getItem('ceston.theme') ?? 'system') === 'system') setTheme('system'); });
