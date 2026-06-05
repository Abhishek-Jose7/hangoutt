# FRONTEND_INSTRUCTIONS.md

# Overview

This document defines the frontend architecture, UI requirements, UX principles, page structure, component hierarchy, state management, design system, responsiveness standards, and implementation guidelines for MeetUp AI.

The frontend must feel modern, social, and practical.

The goal is not to look like an AI product.

The goal is to feel like a mix of:

* Splitwise
* Airbnb
* Google Maps
* Discord Events
* Notion

The application should prioritize clarity, collaboration, and speed.

---

# Product Experience Goals

Users should be able to:

1. Create a group within 30 seconds.

2. Invite friends in under 10 seconds.

3. Understand recommendations immediately.

4. Never feel overwhelmed by complexity.

5. Use the app comfortably on mobile.

---

# Design Philosophy

Avoid:

* AI gradients everywhere
* Floating glassmorphism panels
* Excessive animations
* Overly futuristic interfaces
* Neon cyberpunk styling

Prefer:

* Clean layouts
* Practical information density
* Strong typography
* Useful visuals
* Fast interactions

---

# Visual Identity

Theme:

Modern Social Planning

Mood:

Friendly

Efficient

Trustworthy

Fun

Exploratory

---

# Color Usage

Primary:

Used for:

* Buttons
* Links
* Active tabs
* Highlights

Secondary:

Used for:

* Supporting actions
* Badges

Neutral:

Used for:

* Backgrounds
* Cards
* Borders

Success:

* Confirmations
* Votes
* Approved plans

Warning:

* Budget issues
* Missing information

Danger:

* Delete actions

---

# Typography

Heading Hierarchy

H1

Landing page hero

H2

Section headers

H3

Cards

H4

Small sections

---

Body Text

Readable on:

* Mobile
* Tablet
* Desktop

Minimum size:

16px

---

# Mobile First Design

Primary target:

Mobile

Breakpoints:

Mobile

320px+

Tablet

768px+

Desktop

1024px+

Large Desktop

1440px+

---

# Navigation Structure

Unauthenticated

Landing

Features

About

Login

Signup

---

Authenticated

Dashboard

Groups

Planner

History

Profile

Settings

---

# Application Layout

Desktop

Sidebar

Main Content

Optional Right Panel

---

Mobile

Bottom Navigation

Main Content

Floating Action Button

---

# Landing Page

Route

/

Purpose

Convert visitors into users.

---

Sections

Hero

Problem Statement

How It Works

Features

Testimonials

Call To Action

Footer

---

Hero Section

Contains:

Headline

Subheadline

Primary CTA

Secondary CTA

Hero Illustration

---

Example Flow Illustration

Create Group

↓

Invite Friends

↓

Enter Budgets

↓

Get Plan

↓

Meet Up

---

# Authentication Pages

Routes

/sign-in

/sign-up

---

Requirements

Use Clerk UI Components.

Minimal customization.

Fast loading.

Mobile friendly.

---

# Dashboard

Route

/dashboard

Purpose

Home base after login.

---

Sections

Welcome Banner

Upcoming Plans

Active Groups

Recent Activity

Quick Actions

---

Quick Actions

Create Group

Join Group

View History

Explore Places

---

# Groups Page

Route

/groups

Purpose

Display all user groups.

---

Features

Group Search

Group Filters

Group Sorting

Create Group

Join Group

---

Group Card

Contains:

Group Name

Members Count

Status

Upcoming Plan

Last Activity

---

# Group Details Page

Route

/groups/[id]

Purpose

Central planning workspace.

---

Sections

Group Header

Members

Budgets

Locations

Recommendations

Voting

Itinerary

---

Group Header

Contains:

Group Name

Description

Invite Button

Share Button

Delete Option

---

Members Section

Displays:

Avatar

Name

Role

Budget Status

Location Status

---

Budget Section

Shows:

Individual Budget

Average Budget

Total Budget

Budget Range

---

Location Section

Map Preview

Participant Locations

Calculated Midpoint

Travel Estimates

---

# Planner Page

Route

/planner/[groupId]

Purpose

View generated plans.

---

Layout

Map Panel

Recommendation Panel

Itinerary Panel

---

Map Panel

Displays:

Midpoint

Venues

Distances

Markers

---

Recommendation Panel

Displays:

Top Venues

Ratings

Distance

Estimated Cost

---

Itinerary Panel

Displays:

Plan A

Plan B

Plan C

---

# Voting Interface

Requirements

Very simple.

---

Option Card

Contains:

Venue

Score

Distance

Estimated Cost

Vote Button

---

Voting States

Not Voted

Voted

Winning

Closed

---

# History Page

Route

/history

Purpose

Show completed outings.

---

Features

Search

Filters

Timeline View

Group View

---

History Card

Contains:

Date

Group Name

Plan Summary

Participants

Total Cost

---

# Profile Page

Route

/profile

Purpose

Manage user information.

---

Sections

Basic Information

Preferences

Saved Activities

Past Statistics

---

Preferences

Budget Range

Favorite Activities

Travel Radius

Preferred Hangout Types

---

# Settings Page

Route

/settings

Purpose

Application configuration.

---

Sections

Account

Privacy

Notifications

Appearance

Connected Services

---

# Component Architecture

ui/

button

card

badge

dialog

dropdown

tabs

input

avatar

skeleton

toast

---

features/

groups

planner

budget

voting

history

profile

maps

recommendations

---

# Shared Components

Navbar

Sidebar

BottomNavigation

Modal

SearchBar

LoadingSpinner

EmptyState

ErrorState

---

# State Management

Prefer:

Server Components

Server Actions

URL State

React State

---

Avoid:

Global state unless necessary.

---

Use Global State For

Authenticated User

Theme

Notifications

---

# Forms

All forms must include:

Validation

Loading State

Success State

Error State

---

Examples

Create Group

Join Group

Submit Budget

Vote

Update Profile

---

# Loading States

Every page requires:

Skeleton Loading

Button Loading

Map Loading

---

Never show blank screens.

---

# Error States

Examples

Failed Venue Search

Failed Group Load

Failed Vote Submission

---

User must always know:

What failed

Why

What to do next

---

# Empty States

Examples

No Groups

No History

No Recommendations

No Votes

---

Each empty state must contain:

Explanation

Action Button

---

# Animations

Use sparingly.

Allowed:

Page transitions

Hover effects

Button feedback

Card interactions

Map marker animation

---

Avoid:

Long loading animations

Continuous motion

Decorative animations

---

# Accessibility Requirements

Keyboard navigation

Screen reader support

Semantic HTML

Proper labels

Color contrast compliance

Focus states

---

# Performance Targets

Initial Load

Under 3 seconds

Page Navigation

Under 500ms

Map Rendering

Under 2 seconds

---

# SEO Requirements

Landing page only.

Include:

Meta Tags

Open Graph

Twitter Cards

Structured Data

Sitemap

Robots.txt

---

# Future Frontend Features

Real-time collaboration

Live voting updates

Chat

Calendar integration

Weather overlays

Expense tracking

AI recommendations

Activity feed

PWA support

Offline mode

Native mobile application

---

# Definition Of Done

Frontend feature is complete when:

* Responsive on mobile
* Responsive on desktop
* Accessible
* Error states implemented
* Loading states implemented
* Connected to backend
* Tested manually
* No console errors
* Consistent with design system
* Approved by designer
