<script setup lang="ts">
import CartIndicator from './CartIndicator.vue'
import { RouterLink } from 'vue-router'
import { onMounted, ref } from 'vue'
import type { FrontPageContent } from '../shared/content'
import { requestContent } from './content-api'

const year = new Date().getFullYear()
const content = ref<FrontPageContent | null>(null)
const loading = ref(true)
const error = ref('')

async function loadContent() {
  loading.value = true
  error.value = ''
  try {
    content.value = await requestContent()
  } catch {
    error.value = 'Our story is temporarily unavailable. Please try again.'
  } finally {
    loading.value = false
  }
}

onMounted(loadContent)
</script>

<template>
  <div class="site-shell" id="top">
    <a class="skip-link" href="#main">Skip to content</a>

    <header class="site-header">
      <a class="brand" href="#top" aria-label="Palianytsia Bread home">
        <img class="brand-logo" src="/uploads/paliantsia_horiz.svg" alt="Palianytsia Bread" width="224" height="44" />
      </a>
      <nav class="header-nav" aria-label="Main">
        <RouterLink class="header-link" to="/buy">Buy bread</RouterLink>
        <RouterLink class="header-link" to="/contact">Contact</RouterLink>
        <CartIndicator />
      </nav>
    </header>

    <main id="main">
      <section class="hero" id="our-story" :aria-labelledby="content ? 'welcome-title' : undefined">
        <div class="hero-copy" :aria-busy="loading">
          <p v-if="loading" role="status">Loading our story…</p>
          <div v-else-if="error" role="alert">
            <p>{{ error }}</p>
            <button class="action-button" type="button" @click="loadContent">Try again</button>
          </div>
          <template v-else-if="content">
            <h1 id="welcome-title" v-html="content.title"></h1>
            <p class="subtitle" v-html="content.subtitle"></p>
            <div class="story" v-html="content.story"></div>
          </template>
        </div>

        <img
          class="hero-image"
          src="/uploads/hero_1600px.webp"
          alt="A smiling baker in an apron holding freshly baked baguettes"
          width="1068"
          height="1600"
          fetchpriority="high"
        />
      </section>

      <div class="photo-gallery">
        <img
          src="/uploads/DSC_7208_1600px.webp"
          alt="A baker smoothing dough in a loaf tin"
          width="1600"
          height="1068"
          loading="lazy"
        />
        <img
          src="/uploads/DSC_7201_800px.webp"
          alt="A baker spooning dough into a loaf tin on a scale"
          width="534"
          height="800"
          loading="lazy"
        />
        <img
          src="/uploads/DSC_7108_800px.webp"
          alt="A baker holding a round of dough over a floured table"
          width="534"
          height="800"
          loading="lazy"
        />
      </div>
    </main>

    <footer class="site-footer">
      <p>© {{ year }} Palianytsia Bread</p>
      <RouterLink class="footer-link" to="/contact">Contact</RouterLink>
      <p class="footer-note"><span class="ukraine-mark" aria-hidden="true"></span> Rooted in Ukrainian tradition.</p>
    </footer>
  </div>
</template>
