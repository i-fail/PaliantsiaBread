<script setup lang="ts">
import CartIndicator from './CartIndicator.vue'
import { RouterLink } from 'vue-router'

const year = new Date().getFullYear()

const place = 'The Hood Kitchen'
const forName = 'For Palianytsia Bread'
const street = '350 Clinton St Ste A'
const city = 'Costa Mesa, CA 92626'
const country = 'United States'
const phone = '(424) 408-0552'
const phoneLink = 'tel:+14244080552'
const mapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place}, ${street}, ${city}`)}`
</script>

<template>
  <div class="site-shell">
    <header class="site-header">
      <RouterLink class="brand" to="/" aria-label="Palianytsia Bread home">
        <img class="brand-logo" src="/uploads/paliantsia_horiz.svg" alt="Palianytsia Bread" width="224" height="44" />
      </RouterLink>
      <nav class="header-nav" aria-label="Main">
        <RouterLink class="header-link" to="/">Our story</RouterLink>
        <RouterLink class="header-link" to="/buy">Buy bread</RouterLink>
        <CartIndicator />
      </nav>
    </header>

    <main aria-label="Contact" class="buy-main contact-main">
      <h1>Contact</h1>
      <div class="contact-details">
        <section aria-labelledby="contact-address">
          <h2 id="contact-address">Find us</h2>
          <address>
            <strong>{{ place }}</strong><br />
            {{ forName }}<br />
            {{ street }}<br />
            {{ city }}<br />
            {{ country }}
          </address>
          <p><a class="contact-link" :href="mapsLink" target="_blank" rel="noopener noreferrer">Get directions</a></p>
        </section>
        <section aria-labelledby="contact-phone">
          <h2 id="contact-phone">Call us</h2>
          <p><a class="contact-link" :href="phoneLink">{{ phone }}</a></p>
        </section>
      </div>
    </main>

    <footer class="site-footer">
      <p>© {{ year }} Palianytsia Bread</p>
      <RouterLink class="footer-link" to="/contact">Contact</RouterLink>
      <p class="footer-note"><span class="ukraine-mark" aria-hidden="true"></span> Rooted in Ukrainian tradition.</p>
    </footer>
  </div>
</template>
