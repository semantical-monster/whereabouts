import { create } from 'zustand';

export const useQuizStore = create((set, get) => ({
  // UI state
  view: 'usa',         // 'usa' | 'state' | 'about'
  activeState: null,
  activeCategory: 'counties', // 'counties' | 'rivers' | 'peaks' | 'parks' | 'forests' | 'cities'
  quizMode: 'drag-drop', // 'drag-drop' | 'click-id'

  // Quiz state
  score: 0,
  streak: 0,
  bestStreak: 0,
  identified: new Set(),
  correct: new Set(),
  wrong: new Set(),
  currentTarget: null,
  multiOptions: [],
  feedback: null,  // { text, type: 'correct'|'wrong' }

  // Actions
  setView: (view) => set({ view }),
  setActiveState: (state) => set({ activeState: state, view: 'state', identified: new Set(), correct: new Set(), wrong: new Set() }),
  setActiveCategory: (cat) => set({ activeCategory: cat, correct: new Set(), wrong: new Set(), score: 0, streak: 0 }),
  setQuizMode: (mode) => set({ quizMode: mode, currentTarget: null, feedback: null }),

  addScore: (pts) => set((s) => {
    const streak = s.streak + 1;
    return {
      score: s.score + pts + (streak > 2 ? streak * 10 : 0),
      streak,
      bestStreak: Math.max(s.bestStreak, streak),
    };
  }),

  breakStreak: () => set({ streak: 0 }),

  markCorrect: (id) => set((s) => {
    const correct = new Set(s.correct);
    correct.add(id);
    const wrong = new Set(s.wrong);
    wrong.delete(id);
    return { correct, wrong };
  }),

  markWrong: (id) => set((s) => {
    const wrong = new Set(s.wrong);
    wrong.add(id);
    return { wrong };
  }),

  setTarget: (id) => set({ currentTarget: id }),
  setMultiOptions: (opts) => set({ multiOptions: opts }),
  setFeedback: (feedback) => set({ feedback }),
  clearFeedback: () => set({ feedback: null }),

  resetQuiz: () => set({
    score: 0, streak: 0, identified: new Set(),
    correct: new Set(), wrong: new Set(),
    currentTarget: null, feedback: null,
  }),
}));
