import nodemailer from "nodemailer";
import { config } from "../config.js";

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465,
  auth: {
    user: config.smtp.user,
    pass: config.smtp.password
  }
});

export async function verifyEmailConnection() {
  if (!config.smtp.host || !config.smtp.user || !config.smtp.password) {
    throw new Error("ZeptoMail SMTP settings are incomplete");
  }
  return transporter.verify();
}

export function createEmployeeInvitationMessage({ to, fullName, temporaryPassword, employeeId, department, title }) {
  const safeName = escapeHtml(fullName);
  const safeEmail = escapeHtml(to);
  const safePassword = escapeHtml(temporaryPassword);
  const safeEmployeeId = escapeHtml(employeeId);
  const safeDepartment = escapeHtml(department);
  const safeTitle = escapeHtml(title);
  const loginUrl = config.appUrl;
  const logoUrl = `${config.appUrl.replace(/\/+$/, "")}/luxmor-logo.jpeg`;

  return {
    from: `"${config.appName}" <${config.smtp.fromEmail}>`,
    to,
    subject: `Your ${config.appName} employee account`,
    text: [
      `Hello ${fullName},`,
      "",
      `Your ${config.appName} employee account is ready.`,
      `Username: ${to}`,
      `Employee ID: ${employeeId}`,
      `Temporary password: ${temporaryPassword}`,
      `Sign in: ${loginUrl}`,
      "",
      "You will be required to create a new password after your first sign-in.",
      "Do not share this temporary password."
    ].join("\n"),
    html: `<!doctype html>
      <html><body style="margin:0;background:#f4f6fa;font-family:Arial,sans-serif;color:#172033">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px;background:#f4f6fa">
          <tr><td align="center">
            <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #e2e7ef;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px rgba(18,33,61,.08)">
              <tr><td align="center" style="padding:24px 30px 18px;background:#ffffff">
                <img src="${logoUrl}" width="330" alt="Luxmor AI Technologies" style="display:block;width:100%;max-width:330px;height:auto;border:0">
              </td></tr>
              <tr><td style="height:5px;background:linear-gradient(90deg,#5725cc,#2557d6,#13a7dc);font-size:0;line-height:0">&nbsp;</td></tr>
              <tr><td style="padding:32px 30px">
                <p style="margin:0 0 10px;color:#2557d6;font-size:12px;font-weight:700;letter-spacing:1px">${config.appName.toUpperCase()} · EMPLOYEE INVITATION</p>
                <h1 style="margin:0 0 14px;font-size:25px">Welcome, ${safeName}</h1>
                <p style="margin:0 0 22px;color:#5f6c80;line-height:1.6">Your company communication account has been created for your role as <strong>${safeTitle}</strong> in <strong>${safeDepartment}</strong>.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fc;border-radius:9px;padding:18px">
                  <tr><td style="padding:5px;color:#7c8798;font-size:12px">Username</td><td style="padding:5px;font-weight:700">${safeEmail}</td></tr>
                  <tr><td style="padding:5px;color:#7c8798;font-size:12px">Employee ID</td><td style="padding:5px;font-weight:700">${safeEmployeeId}</td></tr>
                  <tr><td style="padding:5px;color:#7c8798;font-size:12px">Temporary password</td><td style="padding:5px;font-family:monospace;font-weight:700">${safePassword}</td></tr>
                </table>
                <p style="margin:18px 0;color:#6b7688;font-size:13px;line-height:1.5">For security, you must create a new password immediately after your first sign-in.</p>
                <a href="${loginUrl}" style="display:inline-block;padding:13px 22px;border-radius:8px;background:#2557d6;color:#fff;text-decoration:none;font-weight:700;box-shadow:0 5px 14px rgba(37,87,214,.22)">Sign in to ${config.appName}</a>
                <p style="margin:24px 0 0;color:#9aa3b1;font-size:11px">If you were not expecting this invitation, contact your HR administrator.</p>
              </td></tr>
              <tr><td align="center" style="padding:17px 25px;background:#f7f9fc;border-top:1px solid #edf0f5;color:#8b95a5;font-size:11px">Luxmor AI Technologies Pvt Ltd · Secure internal communication</td></tr>
            </table>
          </td></tr>
        </table>
      </body></html>`
  };
}

export async function sendEmployeeInvitation(details) {
  await transporter.sendMail(createEmployeeInvitationMessage(details));
}

export async function sendPasswordResetCompleted({ to, fullName, temporaryPassword }) {
  const safeName = escapeHtml(fullName);
  const safeEmail = escapeHtml(to);
  const safePassword = escapeHtml(temporaryPassword);
  const loginUrl = config.appUrl;
  const logoUrl = `${config.appUrl.replace(/\/+$/, "")}/luxmor-logo.jpeg`;

  await transporter.sendMail({
    from: `"${config.appName}" <${config.smtp.fromEmail}>`,
    to,
    subject: `Your ${config.appName} password has been reset`,
    text: [
      `Hello ${fullName},`, "", "Your password reset request has been completed by an administrator.",
      `Username: ${to}`, `Temporary password: ${temporaryPassword}`, `Sign in: ${loginUrl}`, "",
      "You must create a new private password immediately after signing in.",
      "Do not share this temporary password."
    ].join("\n"),
    html: `<!doctype html><html><body style="margin:0;background:#f4f6fa;font-family:Arial,sans-serif;color:#172033">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px"><tr><td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #e2e7ef;border-radius:14px;overflow:hidden">
          <tr><td align="center" style="padding:22px"><img src="${logoUrl}" width="300" alt="Luxmor AI Technologies" style="display:block;max-width:100%;height:auto"></td></tr>
          <tr><td style="height:5px;background:#2557d6"></td></tr>
          <tr><td style="padding:30px"><p style="color:#2557d6;font-size:12px;font-weight:700;letter-spacing:1px">PASSWORD RESET COMPLETE</p>
            <h1 style="font-size:24px">Hello, ${safeName}</h1><p style="color:#5f6c80;line-height:1.6">An administrator has reset your ${config.appName} password.</p>
            <table role="presentation" width="100%" style="background:#f4f7fc;border-radius:9px;padding:18px">
              <tr><td style="padding:5px;color:#7c8798">Username</td><td style="padding:5px;font-weight:700">${safeEmail}</td></tr>
              <tr><td style="padding:5px;color:#7c8798">Temporary password</td><td style="padding:5px;font-family:monospace;font-weight:700">${safePassword}</td></tr>
            </table>
            <p style="color:#6b7688;font-size:13px;line-height:1.5">Sign in with this temporary password. You will then be required to create a new private password.</p>
            <a href="${loginUrl}" style="display:inline-block;padding:13px 22px;border-radius:8px;background:#2557d6;color:#fff;text-decoration:none;font-weight:700">Sign in to ${config.appName}</a>
            <p style="margin-top:24px;color:#9aa3b1;font-size:11px">If you did not request this reset, contact your administrator immediately.</p>
          </td></tr>
        </table>
      </td></tr></table></body></html>`
  });
}

export async function sendPasswordResetCode({ to, fullName, code }) {
  if (!config.smtp.host || !config.smtp.user || !config.smtp.password || !config.smtp.fromEmail) {
    throw new Error("Email delivery is not configured");
  }

  const safeName = escapeHtml(fullName);
  const safeCode = escapeHtml(code);
  await transporter.sendMail({
    from: `"${config.appName}" <${config.smtp.fromEmail}>`,
    to,
    subject: `Your ${config.appName} password reset code`,
    text: [
      `Hello ${fullName},`,
      "",
      `Your password reset verification code is ${code}.`,
      "This code expires in 10 minutes and can only be used once.",
      "If you did not request this code, you can ignore this email."
    ].join("\n"),
    html: `<!doctype html><html><body style="margin:0;padding:32px;background:#f4f6fa;font-family:Arial,sans-serif;color:#172033">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
        <table role="presentation" width="520" cellspacing="0" cellpadding="0" style="max-width:100%;background:#fff;border:1px solid #e2e7ef;border-radius:14px;overflow:hidden">
          <tr><td style="height:5px;background:#2557d6"></td></tr>
          <tr><td style="padding:30px"><p style="color:#2557d6;font-size:12px;font-weight:700;letter-spacing:1px">PASSWORD RESET</p>
            <h1 style="font-size:23px">Hello, ${safeName}</h1>
            <p style="color:#5f6c80;line-height:1.6">Enter this verification code to reset your ${config.appName} password.</p>
            <p style="padding:18px;background:#f4f7fc;border-radius:9px;text-align:center;font-family:monospace;font-size:30px;font-weight:700;letter-spacing:8px">${safeCode}</p>
            <p style="color:#6b7688;font-size:13px;line-height:1.5">This code expires in 10 minutes and can only be used once. If you did not request it, ignore this email.</p>
          </td></tr>
        </table>
      </td></tr></table></body></html>`
  });
}

export async function sendSupportRequest({ user, category, subject, message }) {
  const safeName = escapeHtml(user.full_name);
  const safeEmail = escapeHtml(user.email);
  const safeEmployeeId = escapeHtml(user.employee_id);
  const safeCategory = escapeHtml(category);
  const safeSubject = escapeHtml(subject);
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br>");
  const logoUrl = `${config.appUrl.replace(/\/+$/, "")}/luxmor-logo.jpeg`;

  await transporter.sendMail({
    from: `"${config.appName} Support" <${config.smtp.fromEmail}>`,
    to: [...new Set([config.adminEmail, config.smtp.fromEmail].filter(Boolean))],
    replyTo: user.email,
    subject: `[${config.appName} Support] ${subject}`,
    text: `Support request from ${user.full_name} (${user.email}, ${user.employee_id})\nCategory: ${category}\nSubject: ${subject}\n\n${message}`,
    html: `<!doctype html><html><body style="margin:0;background:#f4f6fa;font-family:Arial,sans-serif;color:#172033">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:28px 12px"><tr><td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #e2e7ef;border-radius:14px;overflow:hidden">
          <tr><td align="center" style="padding:20px"><img src="${logoUrl}" width="290" alt="Luxmor AI Technologies" style="display:block;width:100%;max-width:290px;height:auto"></td></tr>
          <tr><td style="height:5px;background:#2557d6"></td></tr>
          <tr><td style="padding:28px">
            <p style="margin:0 0 8px;color:#2557d6;font-size:12px;font-weight:700;letter-spacing:1px">${safeCategory.toUpperCase()}</p>
            <h1 style="margin:0 0 20px;font-size:23px">${safeSubject}</h1>
            <table role="presentation" width="100%" style="background:#f5f7fb;border-radius:8px;padding:14px;margin-bottom:20px">
              <tr><td style="color:#7d8797;font-size:12px;padding:3px">Employee</td><td style="font-weight:700">${safeName}</td></tr>
              <tr><td style="color:#7d8797;font-size:12px;padding:3px">Email</td><td>${safeEmail}</td></tr>
              <tr><td style="color:#7d8797;font-size:12px;padding:3px">Employee ID</td><td>${safeEmployeeId}</td></tr>
            </table>
            <div style="font-size:14px;line-height:1.7;color:#465267">${safeMessage}</div>
          </td></tr>
        </table>
      </td></tr></table>
    </body></html>`
  });
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}
