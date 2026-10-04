<script setup lang="ts">
import { reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { contactLimits } from '../shared/contact'
import CartIndicator from './CartIndicator.vue'
import { sendContactMessage } from './contact-api'

const year = new Date().getFullYear()

const place = 'The Hood Kitchen'
const forName = 'For Palianytsia Bread'
const street = '350 Clinton St Ste A'
const city = 'Costa Mesa, CA 92626'
const country = 'United States'
const phone = '(424) 408-0552'
const phoneLink = 'tel:+14244080552'
const mapsLink = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place}, ${street}, ${city}`)}`

// "website" is a trap for automated form fillers: people never see it, so it stays empty for them.
const form = reactive({ name: '', email: '', message: '', website: '' })
const sending = ref(false)
const sent = ref(false)
const error = ref('')

async function submit() {
  sending.value = true
  sent.value = false
  error.value = ''
  try {
    await sendContactMessage({ ...form })
    Object.assign(form, { name: '', email: '', message: '', website: '' })
    sent.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'We couldn’t send your message right now. Please try again later or call us.'
  } finally {
    sending.value = false
  }
}
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

      <section class="contact-form-section" aria-labelledby="contact-form-title">
        <h2 id="contact-form-title">Send us a message</h2>
        <p v-if="sent" class="contact-sent" role="status">Thank you! Your message has been sent. We’ll get back to you soon.</p>
        <form class="contact-form" @submit.prevent="submit">
          <div class="contact-field">
            <label for="contact-name">Name</label>
            <input id="contact-name" v-model="form.name" required autocomplete="name" :maxlength="contactLimits.name" :disabled="sending" />
          </div>
          <div class="contact-field">
            <label for="contact-email">Email</label>
            <input id="contact-email" v-model="form.email" type="email" required autocomplete="email" :maxlength="contactLimits.email" :disabled="sending" />
          </div>
          <div class="contact-field">
            <label for="contact-message">Message</label>
            <textarea id="contact-message" v-model="form.message" required rows="6" :maxlength="contactLimits.message" :disabled="sending"></textarea>
          </div>
          <div class="contact-trap" aria-hidden="true">
            <label for="contact-website">Leave this field empty</label>
            <input id="contact-website" v-model="form.website" tabindex="-1" autocomplete="off" />
          </div>
          <p v-if="error" class="error-message" role="alert">{{ error }}</p>
          <button class="action-button" type="submit" :disabled="sending">{{ sending ? 'Sending…' : 'Send message' }}</button>
        </form>
      </section>
    </main>

    <footer class="site-footer">
      <p>© {{ year }} Palianytsia Bread</p>
      <RouterLink class="footer-link" to="/contact">Contact</RouterLink>
      <p class="footer-note"><span class="ukraine-mark" aria-hidden="true"></span> Rooted in Ukrainian tradition.</p>
    </footer>
  </div>
</template>
