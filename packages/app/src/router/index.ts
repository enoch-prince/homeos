import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/',        component: HomeView },
    { path: '/pantry',  component: () => import('@/views/PantryView.vue') },
    { path: '/finance', component: () => import('@/views/FinanceView.vue') },
    { path: '/chores',  component: () => import('@/views/ChoresView.vue') },
    { path: '/more',    component: () => import('@/views/MoreView.vue') },
  ],
})
